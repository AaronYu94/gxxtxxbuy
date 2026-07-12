// V2-10-01/02/04 — international-shipping coupon rules (pure).

// Validate a coupon definition at create time. Rejects invalid ratios, negative
// amounts, and inverted time windows.
export function validateCouponDef(def) {
  if (!def || typeof def !== "object") return { ok: false, reason: "coupon body required" };
  const type = def.discount_type;
  if (!["fixed", "percent", "threshold"].includes(type)) return { ok: false, reason: "discount_type must be fixed/percent/threshold" };
  if (type === "fixed" && !(Number.isInteger(def.fixed_value_minor) && def.fixed_value_minor > 0)) return { ok: false, reason: "fixed_value_minor must be > 0" };
  if (type === "percent") {
    if (!(Number.isInteger(def.percent_bps) && def.percent_bps > 0 && def.percent_bps <= 10000)) return { ok: false, reason: "percent_bps must be 1..10000" };
  }
  if (type === "threshold") {
    if (!(Number.isInteger(def.threshold_min_minor) && def.threshold_min_minor > 0)) return { ok: false, reason: "threshold_min_minor must be > 0" };
    if (!(Number.isInteger(def.threshold_discount_minor) && def.threshold_discount_minor > 0)) return { ok: false, reason: "threshold_discount_minor must be > 0" };
  }
  for (const f of ["fixed_value_minor", "percent_bps", "threshold_min_minor", "threshold_discount_minor", "max_discount_minor"]) {
    if (def[f] != null && (!Number.isInteger(def[f]) || def[f] < 0)) return { ok: false, reason: `${f} must be a non-negative integer` };
  }
  if (def.per_user_limit != null && (!Number.isInteger(def.per_user_limit) || def.per_user_limit < 1)) return { ok: false, reason: "per_user_limit must be >= 1" };
  if (def.total_quota != null && (!Number.isInteger(def.total_quota) || def.total_quota < 0)) return { ok: false, reason: "total_quota must be >= 0" };
  for (const [a, b] of [["claim_starts_at", "claim_ends_at"], ["use_starts_at", "use_ends_at"]]) {
    if (def[a] && def[b] && Date.parse(def[a]) >= Date.parse(def[b])) return { ok: false, reason: `${a} must precede ${b}` };
  }
  return { ok: true };
}

// The subset of fields that are FROZEN once a coupon is active (editing them would
// rewrite the meaning of coupons already in the wild).
export const FROZEN_AFTER_ACTIVE = [
  "discount_type", "fixed_value_minor", "percent_bps", "threshold_min_minor",
  "threshold_discount_minor", "max_discount_minor", "eligible_countries", "eligible_route_codes"
];

// Is the coupon eligible for a shipment at `nowMs` for this country/route/amount?
export function isCouponEligible(coupon, { country, routeCode, shippingMinor, nowMs }) {
  if (!coupon || coupon.status !== "active") return { eligible: false, reason: "inactive" };
  if (coupon.useStartsAt && nowMs < Date.parse(coupon.useStartsAt)) return { eligible: false, reason: "not_started" };
  if (coupon.useEndsAt && nowMs > Date.parse(coupon.useEndsAt)) return { eligible: false, reason: "expired" };
  const countries = coupon.eligibleCountries || [];
  if (countries.length > 0 && country && !countries.includes(country)) return { eligible: false, reason: "country_excluded" };
  const routes = coupon.eligibleRouteCodes || [];
  if (routes.length > 0 && routeCode && !routes.includes(routeCode)) return { eligible: false, reason: "route_excluded" };
  if (coupon.discountType === "threshold" && (shippingMinor || 0) < coupon.thresholdMinMinor) return { eligible: false, reason: "below_threshold" };
  return { eligible: true, reason: null };
}

// The discount a coupon yields on a shipping subtotal (never below 0, never above
// the subtotal). Percent is capped by max_discount_minor when set.
export function couponDiscount(coupon, shippingMinor) {
  const subtotal = Math.max(0, Math.trunc(shippingMinor || 0));
  let d = 0;
  if (coupon.discountType === "fixed") d = coupon.fixedValueMinor;
  else if (coupon.discountType === "percent") {
    d = Math.floor(subtotal * coupon.percentBps / 10000);
    if (coupon.maxDiscountMinor > 0) d = Math.min(d, coupon.maxDiscountMinor);
  } else if (coupon.discountType === "threshold") {
    d = subtotal >= coupon.thresholdMinMinor ? coupon.thresholdDiscountMinor : 0;
  }
  return Math.max(0, Math.min(d, subtotal));
}
