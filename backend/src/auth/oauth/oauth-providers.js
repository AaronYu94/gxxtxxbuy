// Social-login provider registry (pure). Each provider declares its OAuth2/OIDC
// endpoints, scopes, how to read a normalized profile, and where the profile comes
// from (the userinfo endpoint or the OIDC id_token). Client credentials + the
// redirect base are resolved from env; a provider with no client id is "not
// configured" and never offered for the authorize redirect (but the callback logic
// stays fully testable via injection).

function pick(obj, ...keys) { for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return String(obj[k]); return ""; }

export const OAUTH_PROVIDERS = Object.freeze({
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    profileSource: "userinfo",
    mapProfile: (p) => ({ providerUserId: pick(p, "sub", "id"), email: pick(p, "email"), displayName: pick(p, "name", "given_name") })
  },
  apple: {
    label: "Apple",
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    userInfoUrl: null,
    scope: "name email",
    responseMode: "form_post",
    profileSource: "id_token", // Apple returns identity in the OIDC id_token
    mapProfile: (claims) => ({ providerUserId: pick(claims, "sub"), email: pick(claims, "email"), displayName: pick(claims, "name") })
  },
  discord: {
    label: "Discord",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
    profileSource: "userinfo",
    mapProfile: (p) => ({ providerUserId: pick(p, "id"), email: pick(p, "email"), displayName: pick(p, "global_name", "username") })
  },
  facebook: {
    label: "Facebook",
    authorizeUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email",
    scope: "email public_profile",
    profileSource: "userinfo",
    mapProfile: (p) => ({ providerUserId: pick(p, "id"), email: pick(p, "email"), displayName: pick(p, "name") })
  },
  github: {
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scope: "read:user user:email",
    profileSource: "userinfo",
    mapProfile: (p) => ({ providerUserId: pick(p, "id", "node_id"), email: pick(p, "email"), displayName: pick(p, "name", "login") })
  },
  microsoft: {
    label: "Microsoft",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid email profile",
    profileSource: "userinfo",
    mapProfile: (p) => ({ providerUserId: pick(p, "sub", "oid"), email: pick(p, "email", "preferred_username"), displayName: pick(p, "name") })
  }
});

export function isKnownProvider(name) { return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, name); }

// Resolve a provider's live config (client id/secret + redirect uri) from env.
export function providerConfig(name, env = {}) {
  const upper = name.toUpperCase();
  const clientId = env[`oauth${cap(name)}ClientId`] || env[`OAUTH_${upper}_CLIENT_ID`] || "";
  const clientSecret = env[`oauth${cap(name)}ClientSecret`] || env[`OAUTH_${upper}_CLIENT_SECRET`] || "";
  const redirectBase = env.oauthRedirectBase || env.OAUTH_REDIRECT_BASE || "";
  const redirectUri = redirectBase ? `${redirectBase.replace(/\/$/, "")}/auth/oauth/${name}/callback` : "";
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret && redirectBase) };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Build the provider authorize URL for a signed state.
export function buildAuthorizeUrl(name, env, state) {
  const def = OAUTH_PROVIDERS[name];
  const cfg = providerConfig(name, env);
  const url = new URL(def.authorizeUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.scope);
  url.searchParams.set("state", state);
  if (def.responseMode) url.searchParams.set("response_mode", def.responseMode);
  if (def.profileSource === "id_token" || def.scope.includes("openid")) url.searchParams.set("nonce", state.slice(0, 16));
  return url.toString();
}
