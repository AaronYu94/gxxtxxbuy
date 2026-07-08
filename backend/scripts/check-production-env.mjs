// B8-01: production environment configuration checklist.
// Validates that a production .env is complete and free of development placeholders
// before a deploy. Exits non-zero on any blocking finding so CI/CD can gate on it.
import { loadEnvFile, parseEnv } from "../src/config/env.js";

const REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "CORS_ALLOWED_ORIGINS",
  "STORAGE_SIGNING_SECRET",
  "SHIPPING_WEBHOOK_SECRET"
];

// Secrets that must never keep their committed development defaults in production.
const DEV_DEFAULTS = {
  STORAGE_SIGNING_SECRET: "local-dev-storage-signing-secret",
  SHIPPING_WEBHOOK_SECRET: "local-dev-shipping-webhook-secret"
};

export function checkProductionEnv(source = process.env) {
  const errors = [];
  const warnings = [];

  if ((source.NODE_ENV || "").trim() !== "production") {
    warnings.push("NODE_ENV is not 'production'. This checklist is intended for production configs.");
  }

  for (const key of REQUIRED) {
    if (!String(source[key] || "").trim()) {
      errors.push(`${key} is required in production and is missing or empty.`);
    }
  }

  for (const [key, devValue] of Object.entries(DEV_DEFAULTS)) {
    const value = String(source[key] || "").trim();
    if (value && value === devValue) {
      errors.push(`${key} still uses the development default. Set a strong production secret.`);
    }
    if (value && value.length < 24) {
      warnings.push(`${key} is shorter than 24 characters. Prefer a long random secret.`);
    }
  }

  const cors = String(source.CORS_ALLOWED_ORIGINS || "");
  if (cors.includes("*")) {
    errors.push("CORS_ALLOWED_ORIGINS must not contain a wildcard in production.");
  }
  if (/127\.0\.0\.1|localhost/.test(cors)) {
    warnings.push("CORS_ALLOWED_ORIGINS still references localhost/127.0.0.1.");
  }

  const readyDb = String(source.READY_REQUIRES_DATABASE || "true").toLowerCase();
  const readyRedis = String(source.READY_REQUIRES_REDIS || "true").toLowerCase();
  if (["false", "0", "no", "off"].includes(readyDb)) {
    warnings.push("READY_REQUIRES_DATABASE is disabled; readiness will not reflect DB outages.");
  }
  if (["false", "0", "no", "off"].includes(readyRedis)) {
    warnings.push("READY_REQUIRES_REDIS is disabled; readiness will not reflect Redis outages.");
  }

  // Fail if the env cannot even be parsed with production requirements.
  try {
    parseEnv(source, { requireDatabase: true, requireRedis: true });
  } catch (error) {
    errors.push(`Env failed to parse: ${error.message}`);
  }

  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const { errors, warnings } = checkProductionEnv(process.env);
  for (const warning of warnings) console.warn(`WARN  ${warning}`);
  for (const error of errors) console.error(`ERROR ${error}`);
  if (errors.length) {
    console.error(`\nProduction env check FAILED with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`Production env check passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
}
