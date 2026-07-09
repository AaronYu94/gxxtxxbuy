import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));
const NODE_ENV_VALUES = new Set(["development", "test", "staging", "production"]);
const LOG_LEVEL_VALUES = new Set(["debug", "info", "warn", "error", "silent"]);

export class EnvError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EnvError";
    this.details = details;
  }
}

export function loadEnvFile(filePath = DEFAULT_ENV_PATH, target = process.env) {
  if (!existsSync(filePath)) {
    return { loaded: false, path: filePath };
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      throw new EnvError(`Invalid .env line: ${rawLine}`);
    }

    const [, key, rawValue] = match;
    if (target[key] !== undefined) {
      continue;
    }

    target[key] = normalizeEnvValue(rawValue);
  }

  return { loaded: true, path: filePath };
}

export function parseEnv(source = process.env, options = {}) {
  const nodeEnv = readEnum(source, "NODE_ENV", "development", NODE_ENV_VALUES);
  const logLevel = readEnum(source, "REQUEST_LOG_LEVEL", "info", LOG_LEVEL_VALUES);
  const databaseUrl = readOptionalString(source, "DATABASE_URL");
  const redisUrl = readOptionalString(source, "REDIS_URL");

  if (options.requireDatabase && !databaseUrl) {
    throw new EnvError("DATABASE_URL is required for this command.", { key: "DATABASE_URL" });
  }

  if (options.requireRedis && !redisUrl) {
    throw new EnvError("REDIS_URL is required for this command.", { key: "REDIS_URL" });
  }

  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === "production",
    serviceName: readString(source, "SERVICE_NAME", "goatedbuy-backend"),
    appVersion: readString(source, "APP_VERSION", "0.1.0"),
    port: readInteger(source, "PORT", 3000, { min: 1, max: 65535 }),
    logLevel,
    corsAllowedOrigins: readList(source, "CORS_ALLOWED_ORIGINS", ["http://127.0.0.1:8080", "http://localhost:8080"]),
    storageDriver: readEnum(source, "STORAGE_DRIVER", "local", new Set(["local", "memory"])),
    storageBucket: readString(source, "STORAGE_BUCKET", "goatedbuy-local-private"),
    storageLocalDir: readString(source, "STORAGE_LOCAL_DIR", ".data/storage"),
    storagePublicBaseUrl: readString(source, "STORAGE_PUBLIC_BASE_URL", "http://127.0.0.1:3000"),
    storageSigningSecret: readString(source, "STORAGE_SIGNING_SECRET", "local-dev-storage-signing-secret"),
    storageSignedUrlTtlSeconds: readInteger(source, "STORAGE_SIGNED_URL_TTL_SECONDS", 900, { min: 60, max: 86400 }),
    shippingQuoteTtlSeconds: readInteger(source, "SHIPPING_QUOTE_TTL_SECONDS", 900, { min: 60, max: 86400 }),
    shippingWebhookSecret: readString(source, "SHIPPING_WEBHOOK_SECRET", "local-dev-shipping-webhook-secret"),
    welcomeGiftEnabled: readBoolean(source, "WELCOME_GIFT_ENABLED", true),
    welcomeGiftCode: readString(source, "WELCOME_GIFT_CODE", "WELCOME10"),
    welcomeGiftAmountCents: readInteger(source, "WELCOME_GIFT_AMOUNT_CENTS", 1000, { min: 0, max: 100000 }),
    linkParseInline: readBoolean(source, "LINK_PARSE_INLINE", false),
    riskCouponAbuseEnabled: readBoolean(source, "RISK_COUPON_ABUSE_ENABLED", false),
    riskCouponAbuseThreshold: readInteger(source, "RISK_COUPON_ABUSE_THRESHOLD", 5, { min: 1, max: 1000 }),
    features: Object.freeze({
      payments: readBoolean(source, "FEATURE_PAYMENTS_ENABLED", true),
      shipping: readBoolean(source, "FEATURE_SHIPPING_ENABLED", true),
      coupons: readBoolean(source, "FEATURE_COUPONS_ENABLED", true),
      creators: readBoolean(source, "FEATURE_CREATORS_ENABLED", true)
    }),
    databaseUrl,
    dbPoolMax: readInteger(source, "DB_POOL_MAX", 5, { min: 1, max: 50 }),
    dbConnectionTimeoutMs: readInteger(source, "DB_CONNECTION_TIMEOUT_MS", 1500, { min: 100, max: 30000 }),
    dbIdleTimeoutMs: readInteger(source, "DB_IDLE_TIMEOUT_MS", 10000, { min: 1000, max: 120000 }),
    redisUrl,
    redisConnectTimeoutMs: readInteger(source, "REDIS_CONNECT_TIMEOUT_MS", 1500, { min: 100, max: 30000 }),
    readyRequiresDatabase: readBoolean(source, "READY_REQUIRES_DATABASE", true),
    readyRequiresRedis: readBoolean(source, "READY_REQUIRES_REDIS", true)
  });
}

export function createEnv(options = {}) {
  loadEnvFile(options.envFilePath);
  return parseEnv(process.env, options);
}

function normalizeEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readOptionalString(source, key) {
  const value = source[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  return String(value).trim();
}

function readString(source, key, fallback) {
  const value = readOptionalString(source, key);
  return value || fallback;
}

function readEnum(source, key, fallback, allowed) {
  const value = readString(source, key, fallback);
  if (!allowed.has(value)) {
    throw new EnvError(`${key} must be one of: ${Array.from(allowed).join(", ")}.`, { key, value });
  }
  return value;
}

function readInteger(source, key, fallback, { min, max }) {
  const value = readString(source, key, String(fallback));
  if (!/^\d+$/.test(value)) {
    throw new EnvError(`${key} must be an integer.`, { key, value });
  }

  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new EnvError(`${key} must be between ${min} and ${max}.`, { key, value });
  }

  return parsed;
}

function readBoolean(source, key, fallback) {
  const value = readString(source, key, String(fallback)).toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(value)) {
    return false;
  }
  throw new EnvError(`${key} must be a boolean.`, { key, value });
}

function readList(source, key, fallback) {
  const value = readOptionalString(source, key);
  if (!value) {
    return fallback;
  }
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
