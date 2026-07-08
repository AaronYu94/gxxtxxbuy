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

export function publicErrorMessage(error) {
  const message = error?.message || "Unknown error";
  return message
    .replace(/postgres:\/\/[^@\s]+@/g, "postgres://[REDACTED]@")
    .replace(/redis:\/\/[^@\s]+@/g, "redis://[REDACTED]@");
}
