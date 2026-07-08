import { createHmac, timingSafeEqual } from "node:crypto";

export function signPaymentWebhook(payload, secret) {
  if (!secret || secret.length < 12) {
    throw new Error("Shipping webhook secret is not configured.");
  }
  return createHmac("sha256", secret)
    .update(stableStringify(payload))
    .digest("base64url");
}

export function verifyPaymentWebhookSignature(payload, signature, secret) {
  if (!payload || !signature || !secret) return false;
  const expected = Buffer.from(signPaymentWebhook(payload, secret), "base64url");
  const actual = Buffer.from(String(signature), "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
  }).join(",")}}`;
}
