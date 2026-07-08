import { createHmac, timingSafeEqual } from "node:crypto";

export function createSignedUrlHelper(env) {
  return {
    sign({ key, expiresInSeconds = env.storageSignedUrlTtlSeconds }) {
      return signPrivateObjectUrl({
        key,
        baseUrl: env.storagePublicBaseUrl,
        secret: env.storageSigningSecret,
        expiresInSeconds
      });
    },

    verify({ key, expires, signature }) {
      return verifyPrivateObjectSignature({
        key,
        expires,
        signature,
        secret: env.storageSigningSecret
      });
    }
  };
}

export function signPrivateObjectUrl({ key, baseUrl, secret, expiresInSeconds, now = new Date() }) {
  if (!key) {
    throw new Error("Storage key is required for signed URL.");
  }
  if (!secret || secret.length < 12) {
    throw new Error("Storage signing secret is not configured.");
  }

  const expiresAt = Math.floor(now.getTime() / 1000) + Number(expiresInSeconds || 900);
  const signature = createPrivateObjectSignature(key, expiresAt, secret);
  const url = new URL(`/storage/private/${encodeURIComponent(key)}`, baseUrl || "http://127.0.0.1:3000");
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function verifyPrivateObjectSignature({ key, expires, signature, secret, now = new Date() }) {
  if (!key || !signature || !secret) return false;
  const expiresAt = Number(expires);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now.getTime() / 1000)) {
    return false;
  }

  const expected = Buffer.from(createPrivateObjectSignature(key, expiresAt, secret), "base64url");
  const actual = Buffer.from(String(signature), "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function createPrivateObjectSignature(key, expiresAt, secret) {
  return createHmac("sha256", secret)
    .update(`${key}.${expiresAt}`)
    .digest("base64url");
}
