import assert from "node:assert/strict";
import test from "node:test";
import { OAUTH_PROVIDERS, providerConfig, buildAuthorizeUrl, isKnownProvider } from "../src/auth/oauth/oauth-providers.js";
import { signState, verifyState } from "../src/auth/oauth/oauth-state.js";
import { createOAuthService, decodeIdToken } from "../src/auth/oauth/oauth-service.js";

// ---- provider registry ----
test("the registry covers Google, Apple, Discord + common providers", () => {
  for (const p of ["google", "apple", "discord", "facebook", "github", "microsoft"]) {
    assert.ok(isKnownProvider(p), `missing ${p}`);
    assert.ok(OAUTH_PROVIDERS[p].label);
    assert.ok(typeof OAUTH_PROVIDERS[p].mapProfile === "function");
  }
  assert.equal(isKnownProvider("myspace"), false);
});

test("a provider is 'not configured' without client credentials", () => {
  assert.equal(providerConfig("google", {}).configured, false);
  const env = { oauthGoogleClientId: "cid", oauthGoogleClientSecret: "sec", oauthRedirectBase: "https://api.x" };
  const cfg = providerConfig("google", env);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.redirectUri, "https://api.x/auth/oauth/google/callback");
});

test("the authorize URL carries client_id, redirect_uri, scope, and state", () => {
  const env = { oauthDiscordClientId: "cid", oauthDiscordClientSecret: "sec", oauthRedirectBase: "https://api.x" };
  const state = signState({ provider: "discord", secret: "s3cr3t-12345" });
  const url = new URL(buildAuthorizeUrl("discord", env, state));
  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "identify email");
  assert.equal(url.searchParams.get("state"), state);
});

// ---- signed state (CSRF) ----
test("state round-trips and rejects tampering, expiry, and wrong provider", () => {
  const secret = "state-secret-abcdef";
  const state = signState({ provider: "google", returnTo: "/home", secret, ttlSeconds: 600, now: 1_000_000_000_000 });
  const ok = verifyState(state, { secret, now: 1_000_000_060_000 });
  assert.equal(ok.valid, true);
  assert.equal(ok.provider, "google");
  assert.equal(ok.returnTo, "/home");
  // Tampered → bad signature.
  assert.equal(verifyState(state + "x", { secret }).valid, false);
  // Wrong secret → bad signature.
  assert.equal(verifyState(state, { secret: "other" }).valid, false);
  // Expired.
  assert.equal(verifyState(state, { secret, now: 1_000_000_000_000 + 601_000 }).reason, "expired");
});

test("an OIDC id_token's claims decode (payload only)", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "apple-123", email: "a@icloud.com" })).toString("base64url");
  const token = `header.${payload}.sig`;
  const claims = decodeIdToken(token);
  assert.equal(claims.sub, "apple-123");
  assert.equal(claims.email, "a@icloud.com");
});

// ---- service: callback flow with injected HTTP ----
function stubAuthService() {
  const calls = [];
  return { calls, async oauthLogin(profile, meta) { calls.push({ profile, meta }); return { user: { id: "user-1", email: profile.email }, session: { access_token: "acc", refresh_token: "ref" }, new_user: true }; }, async listLinkedProviders() { return { providers: [] }; } };
}

const CONFIGURED = {
  oauthGoogleClientId: "gid", oauthGoogleClientSecret: "gsec",
  oauthDiscordClientId: "did", oauthDiscordClientSecret: "dsec",
  oauthRedirectBase: "https://api.x", oauthStateSecret: "state-secret-abcdef"
};

test("start authorization is blocked for an unconfigured provider", () => {
  const svc = createOAuthService({ authService: stubAuthService(), env: {} });
  assert.throws(() => svc.startAuthorization("google", {}), (e) => e.statusCode === 409);
});

test("callback verifies state, exchanges the code, maps the profile, and signs in", async () => {
  const auth = stubAuthService();
  const svc = createOAuthService({
    authService: auth, env: CONFIGURED,
    exchangeCode: async ({ code }) => ({ access_token: `tok-for-${code}` }),
    fetchProfile: async () => ({ id: "disc-9", email: "gamer@x.com", global_name: "Gamer" })
  });
  const { authorize_url, state } = svc.startAuthorization("discord", { returnTo: "/back" });
  assert.match(authorize_url, /discord\.com/);
  const res = await svc.handleCallback("discord", { code: "abc", state, requestMeta: {} });
  assert.equal(res.user.id, "user-1");
  assert.equal(res.session.access_token, "acc");
  assert.equal(res.return_to, "/back");
  // The mapped profile carried the provider id + email.
  assert.equal(auth.calls[0].profile.provider, "discord");
  assert.equal(auth.calls[0].profile.providerUserId, "disc-9");
  assert.equal(auth.calls[0].profile.email, "gamer@x.com");
});

test("callback rejects a forged/expired state before doing anything", async () => {
  const svc = createOAuthService({ authService: stubAuthService(), env: CONFIGURED, exchangeCode: async () => { throw new Error("should not run"); } });
  await assert.rejects(() => svc.handleCallback("discord", { code: "abc", state: "forged.state" }), (e) => e.statusCode === 400);
  // A state minted for a different provider is refused.
  const googleState = signState({ provider: "google", secret: CONFIGURED.oauthStateSecret });
  await assert.rejects(() => svc.handleCallback("discord", { code: "abc", state: googleState }), (e) => e.statusCode === 400);
});
