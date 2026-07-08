import { badRequest } from "../errors/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 128;

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function requireEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw badRequest("A valid email is required.", { field: "email" });
  }
  return email;
}

export function requirePassword(value) {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw badRequest(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`, {
      field: "password"
    });
  }
  return password;
}

export function optionalDisplayName(value) {
  const displayName = String(value || "").trim();
  if (displayName.length > 80) {
    throw badRequest("Display name must be 80 characters or fewer.", { field: "display_name" });
  }
  return displayName;
}

export function requireToken(value, field = "token") {
  const token = String(value || "").trim();
  if (!token) {
    throw badRequest(`${field} is required.`, { field });
  }
  if (token.length > 512) {
    throw badRequest(`${field} is too long.`, { field });
  }
  return token;
}
