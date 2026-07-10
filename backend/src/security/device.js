import { createHash, createHmac } from "node:crypto";

export function hashDeviceFingerprint(rawDeviceId, secret) {
  const normalized = String(rawDeviceId || "").trim();
  if (!normalized) return "";
  return createHmac("sha256", String(secret || "goatedbuy-device-key"))
    .update(normalized)
    .digest("hex");
}

export function hashPrincipal(value) {
  return createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex");
}
