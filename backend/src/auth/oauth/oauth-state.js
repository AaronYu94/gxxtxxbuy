import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// OAuth `state` — a signed, expiring token that ties the callback to the request
// that started it (CSRF defence). Payload: provider + nonce + returnTo + expiry,
// HMAC-signed with the server secret. Opaque to the provider.
export function signState({ provider, returnTo = "", secret, ttlSeconds = 600, now = Date.now(), nonce = null }) {
  if (!secret) throw new Error("OAuth state secret is required.");
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const n = nonce || randomBytes(12).toString("base64url");
  const body = `${provider}.${n}.${exp}.${encodeURIComponent(returnTo)}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}

export function verifyState(state, { secret, now = Date.now() } = {}) {
  if (!state || !secret || typeof state !== "string" || !state.includes(".")) return { valid: false, reason: "malformed" };
  const idx = state.lastIndexOf(".");
  const bodyB64 = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  let body;
  try { body = Buffer.from(bodyB64, "base64url").toString("utf8"); } catch { return { valid: false, reason: "malformed" }; }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad_signature" };
  const [provider, nonce, expStr, returnToEnc] = body.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(now / 1000) > exp) return { valid: false, reason: "expired" };
  return { valid: true, provider, nonce, returnTo: decodeURIComponent(returnToEnc || "") };
}
