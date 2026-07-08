import { badRequest } from "../errors/app-error.js";

export function optionalText(value, field, maxLength = 500) {
  const text = String(value || "").trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer.`, { field });
  }
  return text;
}

export function requiredText(value, field, maxLength = 240) {
  const text = optionalText(value, field, maxLength);
  if (!text) {
    throw badRequest(`${field} is required.`, { field });
  }
  return text;
}

export function optionalMoneyToCents(value, field = "price") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest(`${field} must be greater than 0.`, { field });
  }
  return Math.round(number * 100);
}

export function requiredMoneyToCents(value, field = "price") {
  const cents = optionalMoneyToCents(value, field);
  if (!cents) {
    throw badRequest(`${field} is required.`, { field });
  }
  return cents;
}

export function optionalPositiveInteger(value, field = "quantity") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 999) {
    throw badRequest(`${field} must be a positive integer.`, { field });
  }
  return number;
}

export function requiredPositiveInteger(value, field = "quantity") {
  const number = optionalPositiveInteger(value, field);
  if (!number) {
    throw badRequest(`${field} is required.`, { field });
  }
  return number;
}

export function centsToMoney(cents) {
  if (cents === undefined || cents === null) {
    return null;
  }
  return Number(cents) / 100;
}

export function validateStatus(value, allowed, field = "status") {
  const status = String(value || "").trim();
  if (!status) {
    return "";
  }
  if (!allowed.includes(status)) {
    throw badRequest(`${field} is invalid.`, { field, allowed });
  }
  return status;
}
