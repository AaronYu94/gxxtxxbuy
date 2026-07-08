export function evaluateCouponEligibility({ coupon, userCoupon, parcel, activeApplication = null, now = new Date() }) {
  const reasons = [];

  if (!coupon || coupon.status !== "active") {
    reasons.push(reason("COUPON_INACTIVE", "Coupon is not active."));
  }
  if (!userCoupon || userCoupon.status !== "available") {
    reasons.push(reason("COUPON_NOT_AVAILABLE", "Coupon is not available."));
  }
  if (!parcel || parcel.status !== "shipping_due") {
    reasons.push(reason("PARCEL_NOT_PAYABLE", "Coupon can only be applied before shipping payment."));
  }
  if (coupon?.startsAt && new Date(coupon.startsAt).getTime() > now.getTime()) {
    reasons.push(reason("COUPON_NOT_STARTED", "Coupon is not active yet."));
  }
  if (coupon?.expiresAt && new Date(coupon.expiresAt).getTime() <= now.getTime()) {
    reasons.push(reason("COUPON_EXPIRED", "Coupon has expired."));
  }
  if (activeApplication && !coupon?.combinable) {
    reasons.push(reason("COUPON_NOT_STACKABLE", "Another coupon is already locked for this parcel."));
  }

  const eligibleLineCodes = coupon?.eligibleShippingLineCodes || [];
  if (eligibleLineCodes.length && !eligibleLineCodes.includes(parcel?.shippingLineCode)) {
    reasons.push(reason("LINE_NOT_ELIGIBLE", "Coupon does not apply to this shipping line."));
  }

  const fee = Number(parcel?.finalFeeCents ?? 0);
  if (fee < Number(coupon?.minShippingFeeCents ?? 0)) {
    reasons.push(reason("MINIMUM_NOT_MET", "Parcel shipping fee is below the coupon minimum."));
  }

  const discountCents = reasons.length ? 0 : calculateDiscountCents(coupon, fee);
  if (!reasons.length && discountCents <= 0) {
    reasons.push(reason("NO_DISCOUNT", "Coupon does not reduce this checkout."));
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    discountCents,
    finalFeeCents: Math.max(0, fee - discountCents)
  };
}

export function calculateDiscountCents(coupon, feeCents) {
  if (!coupon) return 0;
  if (coupon.discountType === "percent") {
    const raw = Math.floor((feeCents * Number(coupon.percentOff || 0)) / 100);
    return Math.min(feeCents, coupon.maxDiscountCents === null ? raw : Math.min(raw, coupon.maxDiscountCents));
  }
  return Math.min(feeCents, Number(coupon.amountCents || 0));
}

function reason(code, message) {
  return { code, message };
}
