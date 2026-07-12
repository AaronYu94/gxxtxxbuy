// V2-08-11 — platform final refund accounting. Uses the original item payment
// snapshot and the responsible-party rules; the result is never negative and is
// fully explainable from its breakdown.
//
//  - responsibleParty === 'seller' (seller at fault): the user is made whole — the
//    item payment plus any return freight the user paid — and the merchant's
//    deduction is a merchant/platform matter, not the user's loss.
//  - responsibleParty === 'user' (user at fault): the user bears the merchant's
//    deduction and does not get the return freight back.
//
// All amounts are CNY minor units.
export function computePlatformRefund({ itemTotalMinor, responsibleParty, merchantDeductionMinor = 0, userPaidReturnFeeMinor = 0 }) {
  const base = Math.max(0, Math.trunc(itemTotalMinor || 0));
  const deduction = Math.max(0, Math.trunc(merchantDeductionMinor || 0));
  const returnFee = Math.max(0, Math.trunc(userPaidReturnFeeMinor || 0));

  let refund;
  const breakdown = { item_total_cny_minor: base, responsible_party: responsibleParty };
  if (responsibleParty === "seller") {
    // Make the user whole, including the return freight they fronted.
    refund = base + returnFee;
    breakdown.return_freight_refunded_cny_minor = returnFee;
    breakdown.merchant_deduction_absorbed_cny_minor = deduction; // borne by platform/seller
  } else {
    // User at fault: they absorb the merchant deduction; no return-freight refund.
    refund = base - deduction;
    breakdown.merchant_deduction_cny_minor = deduction;
    breakdown.return_freight_refunded_cny_minor = 0;
  }
  refund = Math.max(0, refund);
  breakdown.platform_refund_cny_minor = refund;
  return { platform_refund_cny_minor: refund, breakdown };
}
