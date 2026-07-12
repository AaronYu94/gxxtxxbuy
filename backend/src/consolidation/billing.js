// V2-07-08/09 — packing-fee billing.
//
// The base packing labor fee is a platform parameter (P1 config seam; a fixed
// default until the config surface lands). Value-added services add to it.
export const PACKING_BASE_FEE_CNY_MINOR = 800; // 8 CNY

// V2-07-09 — the frozen discount order is membership first, then coupon. Both are
// optional (membership = V2-09, coupons = V2-10, not yet built); passing null for
// either is a no-op, so this composes cleanly once those modules exist.
//
//   membership: { discountBps }            e.g. 1000 = 10% off the subtotal
//   coupon:     { type: 'fixed', valueMinor } | { type: 'percent', bps }
//
// Discounts never drive the total below zero, and the coupon applies to the
// post-membership amount (order matters).
export function computeBilling({ subtotalMinor, membership = null, coupon = null }) {
  const subtotal = Math.max(0, Math.trunc(subtotalMinor || 0));

  let membershipDiscount = 0;
  if (membership && Number.isInteger(membership.discountBps) && membership.discountBps > 0) {
    membershipDiscount = Math.floor(subtotal * Math.min(membership.discountBps, 10000) / 10000);
  }
  const afterMembership = subtotal - membershipDiscount;

  let couponDiscount = 0;
  if (coupon) {
    if (coupon.type === "fixed" && Number.isInteger(coupon.valueMinor) && coupon.valueMinor > 0) {
      couponDiscount = Math.min(coupon.valueMinor, afterMembership);
    } else if (coupon.type === "percent" && Number.isInteger(coupon.bps) && coupon.bps > 0) {
      couponDiscount = Math.floor(afterMembership * Math.min(coupon.bps, 10000) / 10000);
    }
  }

  const total = Math.max(0, subtotal - membershipDiscount - couponDiscount);
  return {
    subtotal_cny_minor: subtotal,
    membership_discount_cny_minor: membershipDiscount,
    coupon_discount_cny_minor: couponDiscount,
    total_cny_minor: total
  };
}

// Packing subtotal = base labor fee + the snapshotted value-added-service prices.
export function packingSubtotal(vasItems = []) {
  const vasTotal = vasItems.reduce((sum, v) => sum + Math.max(0, Number(v.priceCnyMinor) || 0), 0);
  return PACKING_BASE_FEE_CNY_MINOR + vasTotal;
}
