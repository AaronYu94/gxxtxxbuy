// V2-03-10 — product payable-price calculation.
//
// payable = unitPrice * quantity + China domestic shipping, all in integer cents.
// Hard rule: an unknown domestic-shipping value must NOT be silently treated as
// zero. When shipping is unknown the result is `complete: false` with no total,
// so the caller (checkout) blocks instead of undercharging. A completed result is
// an immutable calculation snapshot suitable for persistence.

export function calculatePayable({ unitPriceCents, quantity, domesticShippingCents, currency = "CNY" }) {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
    throw new Error("unitPriceCents must be a positive integer.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer.");
  }
  if (domesticShippingCents !== null && (!Number.isInteger(domesticShippingCents) || domesticShippingCents < 0)) {
    throw new Error("domesticShippingCents must be a non-negative integer or null.");
  }

  const itemsCents = unitPriceCents * quantity;

  // Unknown shipping (null) is a first-class state — never coerced to 0.
  if (domesticShippingCents === null) {
    return Object.freeze({
      complete: false,
      reason: "domestic_shipping_unknown",
      currency,
      quantity,
      unitPriceCents,
      itemsCents,
      domesticShippingCents: null,
      totalCents: null
    });
  }

  return Object.freeze({
    complete: true,
    reason: "",
    currency,
    quantity,
    unitPriceCents,
    itemsCents,
    domesticShippingCents,
    totalCents: itemsCents + domesticShippingCents
  });
}
