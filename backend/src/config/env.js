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
    // Social login (OAuth). Per-provider client credentials + the redirect base are
    // optional; a provider with no credentials degrades to "not configured".
    oauthStateSecret: readString(source, "OAUTH_STATE_SECRET", "local-dev-oauth-state-secret"),
    oauthRedirectBase: readOptionalString(source, "OAUTH_REDIRECT_BASE") || "",
    oauthSuccessRedirect: readString(source, "OAUTH_SUCCESS_REDIRECT", "http://127.0.0.1:8080/client.html"),
    oauthGoogleClientId: readOptionalString(source, "OAUTH_GOOGLE_CLIENT_ID") || "",
    oauthGoogleClientSecret: readOptionalString(source, "OAUTH_GOOGLE_CLIENT_SECRET") || "",
    oauthAppleClientId: readOptionalString(source, "OAUTH_APPLE_CLIENT_ID") || "",
    oauthAppleClientSecret: readOptionalString(source, "OAUTH_APPLE_CLIENT_SECRET") || "",
    oauthDiscordClientId: readOptionalString(source, "OAUTH_DISCORD_CLIENT_ID") || "",
    oauthDiscordClientSecret: readOptionalString(source, "OAUTH_DISCORD_CLIENT_SECRET") || "",
    oauthFacebookClientId: readOptionalString(source, "OAUTH_FACEBOOK_CLIENT_ID") || "",
    oauthFacebookClientSecret: readOptionalString(source, "OAUTH_FACEBOOK_CLIENT_SECRET") || "",
    oauthGithubClientId: readOptionalString(source, "OAUTH_GITHUB_CLIENT_ID") || "",
    oauthGithubClientSecret: readOptionalString(source, "OAUTH_GITHUB_CLIENT_SECRET") || "",
    oauthMicrosoftClientId: readOptionalString(source, "OAUTH_MICROSOFT_CLIENT_ID") || "",
    oauthMicrosoftClientSecret: readOptionalString(source, "OAUTH_MICROSOFT_CLIENT_SECRET") || "",
    storageSignedUrlTtlSeconds: readInteger(source, "STORAGE_SIGNED_URL_TTL_SECONDS", 900, { min: 60, max: 86400 }),
    shippingQuoteTtlSeconds: readInteger(source, "SHIPPING_QUOTE_TTL_SECONDS", 900, { min: 60, max: 86400 }),
    shippingWebhookSecret: readString(source, "SHIPPING_WEBHOOK_SECRET", "local-dev-shipping-webhook-secret"),
    welcomeGiftEnabled: readBoolean(source, "WELCOME_GIFT_ENABLED", true),
    welcomeGiftCode: readString(source, "WELCOME_GIFT_CODE", "WELCOME10"),
    welcomeGiftAmountCents: readInteger(source, "WELCOME_GIFT_AMOUNT_CENTS", 1000, { min: 0, max: 100000 }),
    linkParseInline: readBoolean(source, "LINK_PARSE_INLINE", false),
    // Approved marketplace data source (GB-DEC-P0-004). Until a legal provider is
    // approved this stays "not_configured" and every adapter degrades safely.
    productSourceProvider: readString(source, "PRODUCT_SOURCE_PROVIDER", "not_configured"),
    catalogParseMaxAttempts: readInteger(source, "CATALOG_PARSE_MAX_ATTEMPTS", 5, { min: 1, max: 20 }),
    catalogParseBackoffBaseMs: readInteger(source, "CATALOG_PARSE_BACKOFF_BASE_MS", 2000, { min: 100, max: 60000 }),
    catalogParseBackoffMaxMs: readInteger(source, "CATALOG_PARSE_BACKOFF_MAX_MS", 300000, { min: 1000, max: 3600000 }),
    riskCouponAbuseEnabled: readBoolean(source, "RISK_COUPON_ABUSE_ENABLED", false),
    riskCouponAbuseThreshold: readInteger(source, "RISK_COUPON_ABUSE_THRESHOLD", 5, { min: 1, max: 1000 }),
    authVerificationTtlSeconds: readInteger(source, "AUTH_VERIFICATION_TTL_SECONDS", 1800, { min: 60, max: 86400 }),
    authVerificationResendSeconds: readInteger(source, "AUTH_VERIFICATION_RESEND_SECONDS", 60, { min: 1, max: 3600 }),
    authDeviceReverifyDays: readInteger(source, "AUTH_DEVICE_REVERIFY_DAYS", 7, { min: 1, max: 90 }),
    authLoginFailureLimit: readInteger(source, "AUTH_LOGIN_FAILURE_LIMIT", 5, { min: 2, max: 100 }),
    authLoginFailureWindowSeconds: readInteger(source, "AUTH_LOGIN_FAILURE_WINDOW_SECONDS", 900, { min: 60, max: 86400 }),
    authSecurityLockSeconds: readInteger(source, "AUTH_SECURITY_LOCK_SECONDS", 86400, { min: 60, max: 604800 }),
    authDeviceHmacSecret: readString(source, "AUTH_DEVICE_HMAC_SECRET", "local-dev-device-hmac-secret"),
    authTotpEncryptionSecret: readString(source, "AUTH_TOTP_ENCRYPTION_SECRET", "local-dev-totp-encryption-secret"),
    authTotpIssuer: readString(source, "AUTH_TOTP_ISSUER", "GoatedBuy"),
    authAdminChallengeTtlSeconds: readInteger(source, "AUTH_ADMIN_CHALLENGE_TTL_SECONDS", 300, { min: 30, max: 1800 }),
    authReauthTtlSeconds: readInteger(source, "AUTH_REAUTH_TTL_SECONDS", 300, { min: 30, max: 1800 }),
    authAdminAbsoluteSessionHours: readInteger(source, "AUTH_ADMIN_ABSOLUTE_SESSION_HOURS", 24, { min: 1, max: 24 }),
    authExposeVerificationToken: readBoolean(source, "AUTH_EXPOSE_VERIFICATION_TOKEN", nodeEnv !== "production"),
    // Dev-only: skip mandatory admin TOTP and issue a session straight from password login.
    // Double-guarded — force-disabled in production regardless of the env var.
    authAdminMfaBypass: nodeEnv !== "production" && readBoolean(source, "AUTH_ADMIN_MFA_BYPASS", false),
    accountAddressHmacSecret: readString(source, "ACCOUNT_ADDRESS_HMAC_SECRET", "local-dev-address-hmac-secret"),
    accountDeletionPollMs: readInteger(source, "ACCOUNT_DELETION_POLL_MS", 5000, { min: 250, max: 60000 }),
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
