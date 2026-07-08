import { badRequest } from "../errors/app-error.js";

export async function importShippingLines(repository, lines) {
  if (!repository?.upsertShippingLines) {
    throw new Error("Shipping repository with upsertShippingLines is required.");
  }
  if (!Array.isArray(lines) || !lines.length) {
    throw badRequest("Shipping line import must include at least one line.", { field: "lines" });
  }

  const normalized = lines.map(normalizeShippingLine);
  const result = await repository.upsertShippingLines(normalized);
  return {
    imported: result.imported,
    codes: normalized.map((line) => line.code)
  };
}

export function normalizeShippingLine(line, index = 0) {
  return {
    code: requiredText(line.code, `lines.${index}.code`, 80).toUpperCase(),
    name: requiredText(line.name, `lines.${index}.name`, 160),
    destinationCountry: requiredText(line.destination_country ?? line.destinationCountry, `lines.${index}.destination_country`, 80),
    serviceLevel: optionalText(line.service_level ?? line.serviceLevel, 40) || "standard",
    status: normalizeStatus(line.status || "active", index),
    currency: optionalText(line.currency, 3) || "USD",
    billingRules: normalizeObject(line.billing_rules ?? line.billingRules, `lines.${index}.billing_rules`),
    restrictionRules: normalizeObject(line.restriction_rules ?? line.restrictionRules, `lines.${index}.restriction_rules`),
    deliveryMinDays: optionalPositiveInteger(line.delivery_min_days ?? line.deliveryMinDays, `lines.${index}.delivery_min_days`),
    deliveryMaxDays: optionalPositiveInteger(line.delivery_max_days ?? line.deliveryMaxDays, `lines.${index}.delivery_max_days`)
  };
}

function normalizeStatus(value, index) {
  if (!["active", "disabled"].includes(value)) {
    throw badRequest("Shipping line status must be active or disabled.", { field: `lines.${index}.status` });
  }
  return value;
}

function normalizeObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Shipping line rule fields must be objects.", { field });
  }
  return value;
}

function requiredText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw badRequest(`${field} is required.`, { field });
  if (text.length > maxLength) throw badRequest(`${field} is too long.`, { field, maxLength });
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest(`${field} must be a positive integer.`, { field });
  }
  return number;
}
