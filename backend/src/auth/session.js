import { createOpaqueToken, hashIp, hashToken } from "../security/token.js";

const USER_ACCESS_TTL_MS = 15 * 60 * 1000;
const USER_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_ACCESS_TTL_MS = 15 * 60 * 1000;
const ADMIN_REFRESH_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionPayload(actorType, requestMeta = {}, now = new Date(), options = {}) {
  const accessToken = createOpaqueToken(32);
  const refreshToken = createOpaqueToken(48);
  const isAdmin = actorType === "admin";
  const accessTtl = isAdmin ? ADMIN_ACCESS_TTL_MS : USER_ACCESS_TTL_MS;
  const refreshTtl = isAdmin ? ADMIN_REFRESH_TTL_MS : USER_REFRESH_TTL_MS;

  const absoluteExpiresAt = options.absoluteExpiresAt
    || new Date(now.getTime() + (isAdmin ? 24 * 60 * 60 * 1000 : USER_REFRESH_TTL_MS)).toISOString();
  const refreshExpiresAt = new Date(Math.min(
    now.getTime() + refreshTtl,
    new Date(absoluteExpiresAt).getTime()
  )).toISOString();
  return {
    accessToken,
    refreshToken,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: new Date(now.getTime() + accessTtl).toISOString(),
    refreshExpiresAt,
    authenticatedAt: options.authenticatedAt || now.toISOString(),
    absoluteExpiresAt,
    mfaVerifiedAt: options.mfaVerifiedAt || null,
    userAgent: requestMeta.userAgent || "",
    ipHash: hashIp(requestMeta.ip),
    deviceHash: requestMeta.deviceHash || ""
  };
}

export function toSessionResponse(tokens, session) {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: session.expiresAt || session.expires_at || tokens.expiresAt,
    refresh_expires_at: session.refreshExpiresAt || session.refresh_expires_at || tokens.refreshExpiresAt,
    absolute_expires_at: session.absoluteExpiresAt || session.absolute_expires_at || tokens.absoluteExpiresAt,
    token_type: "Bearer"
  };
}
