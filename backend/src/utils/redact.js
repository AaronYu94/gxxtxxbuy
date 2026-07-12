const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization"
]);

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => {
        const normalized = key.toLowerCase();
        if (SENSITIVE_HEADER_NAMES.has(normalized)) {
          return [normalized, "[REDACTED]"];
        }
        return [normalized, String(value).slice(0, 240)];
      })
  );
}

export function redactUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "[REDACTED]";
    }
    if (url.username) {
      url.username = "[USER]";
    }
    return url.toString();
  } catch {
    return "[INVALID_URL]";
  }
}

// V2-12-05 — scrub sensitive fields from a structured log payload before it is
// written. Logs must never contain tokens, full addresses, payment identifiers, or
// identity originals — only references / masked values survive.
const SENSITIVE_FIELD_RE = /(token|authorization|password|secret|api[_-]?key|card|cvv|bank_account|id_number|passport|line1|line2|postal|totp)/i;

export function redactLogFields(obj, depth = 0) {
  if (obj == null || depth > 6) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactLogFields(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELD_RE.test(key)) { out[key] = "[REDACTED]"; continue; }
    out[key] = (value && typeof value === "object") ? redactLogFields(value, depth + 1) : value;
  }
  return out;
}

export function publicErrorMessage(error) {
  const message = error?.message || "Unknown error";
  return message
    .replace(/postgres:\/\/[^@\s]+@/g, "postgres://[REDACTED]@")
    .replace(/redis:\/\/[^@\s]+@/g, "redis://[REDACTED]@");
}
