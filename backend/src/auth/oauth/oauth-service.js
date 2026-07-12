import { badRequest, conflict, notFound } from "../../errors/app-error.js";
import { OAUTH_PROVIDERS, isKnownProvider, providerConfig, buildAuthorizeUrl } from "./oauth-providers.js";
import { signState, verifyState } from "./oauth-state.js";

// Social-login orchestration: build the authorize redirect, then on callback verify
// the state, exchange the code for tokens, read a normalized profile, and hand it to
// authService.oauthLogin (which finds/links/creates the user + issues the session).
// The HTTP steps are injectable so the flow is testable without live providers.
export function createOAuthService({ authService, env = {}, exchangeCode = defaultExchangeCode, fetchProfile = defaultFetchProfile } = {}) {
  if (!authService) throw new Error("Auth service is required for OAuth.");
  const stateSecret = env.oauthStateSecret || env.OAUTH_STATE_SECRET || env.storageSigningSecret || "local-dev-oauth-state-secret";

  return {
    listProviders() {
      return {
        providers: Object.entries(OAUTH_PROVIDERS).map(([name, def]) => ({
          provider: name, label: def.label, configured: providerConfig(name, env).configured
        }))
      };
    },

    // Begin authorization: returns the provider authorize URL to redirect to.
    startAuthorization(provider, { returnTo = "" } = {}) {
      if (!isKnownProvider(provider)) throw notFound("Unknown login provider.");
      const cfg = providerConfig(provider, env);
      if (!cfg.configured) throw conflict("This login provider is not configured.", { code: "not_configured", provider });
      const state = signState({ provider, returnTo, secret: stateSecret });
      return { authorize_url: buildAuthorizeUrl(provider, env, state), state };
    },

    // Handle the provider callback: verify state, exchange code, read profile, sign in.
    async handleCallback(provider, { code, state, requestMeta = {} } = {}) {
      if (!isKnownProvider(provider)) throw notFound("Unknown login provider.");
      const codeStr = String(code || "");
      if (!codeStr) throw badRequest("Authorization code is required.", { field: "code" });
      const parsed = verifyState(state, { secret: stateSecret });
      if (!parsed.valid) throw badRequest(`Invalid OAuth state (${parsed.reason}).`, { code: "bad_state" });
      if (parsed.provider !== provider) throw badRequest("OAuth state does not match the provider.", { code: "state_provider_mismatch" });

      const def = OAUTH_PROVIDERS[provider];
      const cfg = providerConfig(provider, env);
      if (!cfg.configured) throw conflict("This login provider is not configured.", { code: "not_configured", provider });

      const tokens = await exchangeCode({ provider, def, cfg, code: codeStr });
      const raw = await fetchProfile({ provider, def, tokens });
      const profile = def.mapProfile(raw || {});
      if (!profile.providerUserId) throw badRequest("The provider did not return a stable user id.", { code: "no_provider_id" });

      const result = await authService.oauthLogin({ provider, ...profile }, requestMeta);
      return { ...result, return_to: parsed.returnTo || "" };
    }
  };
}

// ---- default HTTP implementations (network; injectable for tests) ----
async function defaultExchangeCode({ def, cfg, code }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri
  });
  const res = await fetch(def.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  if (!res.ok) { const e = new Error(`token exchange failed (${res.status})`); e.statusCode = 502; throw e; }
  return res.json();
}

async function defaultFetchProfile({ def, tokens }) {
  if (def.profileSource === "id_token") return decodeIdToken(tokens?.id_token);
  const res = await fetch(def.userInfoUrl, { headers: { authorization: `Bearer ${tokens?.access_token}`, accept: "application/json", "user-agent": "goatedbuy" } });
  if (!res.ok) { const e = new Error(`profile fetch failed (${res.status})`); e.statusCode = 502; throw e; }
  return res.json();
}

// Decode an OIDC id_token's claims (payload only). NOTE: production must verify the
// signature against the provider JWKS before trusting these claims.
export function decodeIdToken(idToken) {
  if (!idToken || typeof idToken !== "string" || idToken.split(".").length < 2) return {};
  try { return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")); } catch { return {}; }
}
