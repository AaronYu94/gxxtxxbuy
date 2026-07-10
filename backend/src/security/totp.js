import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20) {
  return encodeBase32(randomBytes(bytes));
}

export function generateTotpCode(secret, now = new Date(), options = {}) {
  const stepSeconds = options.stepSeconds || 30;
  const counter = Math.floor(now.getTime() / 1000 / stepSeconds);
  return codeForCounter(secret, counter, options.digits || 6);
}

export function verifyTotpCode({ secret, code, now = new Date(), window = 1, lastCounter = null }) {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return { valid: false, counter: null };
  }
  const current = Math.floor(now.getTime() / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (lastCounter !== null && counter <= Number(lastCounter)) {
      continue;
    }
    const expected = codeForCounter(secret, counter, 6);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      return { valid: true, counter };
    }
  }
  return { valid: false, counter: null };
}

export function encryptTotpSecret(secret, encryptionKey) {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTotpSecret(value, encryptionKey) {
  const [version, ivText, tagText, ciphertextText] = String(value || "").split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) {
    throw new Error("Invalid encrypted TOTP secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(encryptionKey), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function createOtpAuthUri({ secret, account, issuer = "GoatedBuy" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function codeForCounter(secret, counter, digits) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

function deriveKey(value) {
  return createHash("sha256").update(String(value || "")).digest();
}

function encodeBase32(value) {
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function decodeBase32(value) {
  let bits = "";
  for (const character of String(value || "").replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
