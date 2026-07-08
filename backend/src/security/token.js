import { createHash, randomBytes } from "node:crypto";

export function createOpaqueToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function hashIp(value) {
  if (!value) {
    return "";
  }
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}
