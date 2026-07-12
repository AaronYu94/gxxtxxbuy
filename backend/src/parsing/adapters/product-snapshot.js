// The single result contract every marketplace adapter returns. A result is a
// discriminated union keyed by `status`. Only `ok` carries a product; every
// other status is an explicit, recoverable degradation reason — never a guess
// and never fabricated supplier data.
//
// `not_configured` is the default in production until GB-DEC-P0-004 approves a
// legal data source; the placeholder/dev source is the only thing allowed to
// return `ok` before then, and its data must never be shown as real.

export const SNAPSHOT_STATUS = Object.freeze({
  OK: "ok",
  NOT_CONFIGURED: "not_configured", // no approved/licensed provider wired
  UNSUPPORTED: "unsupported", // ref cannot be resolved offline (short/unknown/missing id)
  ITEM_REMOVED: "item_removed", // listing delisted / 404
  LOGIN_WALL: "login_wall", // provider requires an authenticated session
  RATE_LIMITED: "rate_limited", // provider throttled us
  TIMEOUT: "timeout", // provider did not answer in time
  MISSING_FIELDS: "missing_fields", // resolved but required fields absent → manual completion
  PROVIDER_ERROR: "provider_error" // any other upstream failure
});

const DEGRADED = new Set([
  SNAPSHOT_STATUS.NOT_CONFIGURED,
  SNAPSHOT_STATUS.UNSUPPORTED,
  SNAPSHOT_STATUS.ITEM_REMOVED,
  SNAPSHOT_STATUS.LOGIN_WALL,
  SNAPSHOT_STATUS.RATE_LIMITED,
  SNAPSHOT_STATUS.TIMEOUT,
  SNAPSHOT_STATUS.MISSING_FIELDS,
  SNAPSHOT_STATUS.PROVIDER_ERROR
]);

// Transient statuses are worth retrying; the rest are terminal for the job.
const RETRYABLE = new Set([
  SNAPSHOT_STATUS.RATE_LIMITED,
  SNAPSHOT_STATUS.TIMEOUT,
  SNAPSHOT_STATUS.PROVIDER_ERROR
]);

export function isRetryableStatus(status) {
  return RETRYABLE.has(status);
}

export function degraded(status, reason = "") {
  if (!DEGRADED.has(status)) {
    throw new Error(`Unknown degraded snapshot status: ${status}`);
  }
  return { status, reason: String(reason || "") };
}

// Builds a validated `ok` result. Enforces the money invariants the whole
// catalog line depends on:
//   - priceCents must be a positive integer (no floats, no silent zero)
//   - domesticShippingCents is either a non-negative integer or null (unknown);
//     null must never be coerced to 0 by callers — that is the price calculator's
//     job to surface, not to hide.
export function ok(product, platform) {
  const priceCents = asPositiveIntCents(product.priceCents, "priceCents");
  const domesticShippingCents = asOptionalNonNegativeIntCents(
    product.domesticShippingCents,
    "domesticShippingCents"
  );
  const images = Array.isArray(product.images) ? product.images.filter(Boolean).map(String) : [];
  const mainImage = product.mainImage ? String(product.mainImage) : images[0] || "";

  const skus = Array.isArray(product.skus)
    ? product.skus.map((sku) => normalizeSku(sku))
    : [];

  return {
    status: SNAPSHOT_STATUS.OK,
    product: {
      platform,
      title: requireString(product.title, "title"),
      shop: product.shop ? String(product.shop) : "",
      mainImage,
      images,
      priceCents,
      currency: String(product.currency || "CNY").toUpperCase(),
      domesticShippingCents,
      spec: product.spec ? String(product.spec) : "",
      sizes: dedupeStrings(product.sizes),
      colors: dedupeStrings(product.colors),
      skus,
      minOrderQuantity: asOptionalPositiveInt(product.minOrderQuantity),
      priceTiers: Array.isArray(product.priceTiers)
        ? product.priceTiers
            .filter((tier) => Number.isInteger(tier.priceCents) && tier.priceCents > 0)
            .map((tier) => ({
              minQuantity: Number.isInteger(tier.minQuantity) && tier.minQuantity > 0 ? tier.minQuantity : 1,
              priceCents: tier.priceCents
            }))
        : [],
      sourceUrl: product.sourceUrl ? String(product.sourceUrl) : "",
      sourceCapturedAt: product.sourceCapturedAt || null
    }
  };
}

function normalizeSku(sku) {
  return {
    spec: String(sku.spec || ""),
    priceCents: asPositiveIntCents(sku.priceCents, "sku.priceCents"),
    minOrderQuantity: asOptionalPositiveInt(sku.minOrderQuantity),
    available: sku.available !== false
  };
}

function requireString(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Snapshot ${field} is required for an ok result.`);
  }
  return text;
}

function asPositiveIntCents(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Snapshot ${field} must be a positive integer number of cents.`);
  }
  return value;
}

function asOptionalNonNegativeIntCents(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Snapshot ${field} must be a non-negative integer number of cents or null.`);
  }
  return value;
}

function asOptionalPositiveInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isInteger(value) && value > 0 ? value : null;
}

function dedupeStrings(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}
