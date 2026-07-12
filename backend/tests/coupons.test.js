import assert from "node:assert/strict";
import test from "node:test";
import { validateCouponDef, isCouponEligible, couponDiscount } from "../src/promo/coupon-rules.js";
import { createCouponService } from "../src/promo/coupon-service.js";
import { MemoryCouponRepository } from "./helpers/memory-coupon-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const CAMPAIGN = ["campaign_operator"];
const U1 = { id: "11111111-1111-1111-1111-111111111111" };
const U2 = { id: "22222222-2222-2222-2222-222222222222" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

// ---- V2-10-01/02 pure rules ----
test("coupon validation rejects bad ratios, negatives, and inverted windows", () => {
  assert.equal(validateCouponDef({ discount_type: "percent", percent_bps: 0 }).ok, false);
  assert.equal(validateCouponDef({ discount_type: "percent", percent_bps: 20000 }).ok, false);
  assert.equal(validateCouponDef({ discount_type: "fixed", fixed_value_minor: -1 }).ok, false);
  assert.equal(validateCouponDef({ discount_type: "fixed", fixed_value_minor: 500, use_starts_at: "2026-03-10", use_ends_at: "2026-03-01" }).ok, false);
  assert.equal(validateCouponDef({ discount_type: "fixed", fixed_value_minor: 500 }).ok, true);
});

test("discount math: fixed / percent (capped) / threshold, never below zero or above subtotal", () => {
  assert.equal(couponDiscount({ discountType: "fixed", fixedValueMinor: 3000 }, 10000), 3000);
  assert.equal(couponDiscount({ discountType: "fixed", fixedValueMinor: 99999 }, 5000), 5000); // capped at subtotal
  assert.equal(couponDiscount({ discountType: "percent", percentBps: 2000, maxDiscountMinor: 1500 }, 10000), 1500); // 20% capped
  assert.equal(couponDiscount({ discountType: "threshold", thresholdMinMinor: 10000, thresholdDiscountMinor: 2000 }, 9000), 0);
  assert.equal(couponDiscount({ discountType: "threshold", thresholdMinMinor: 10000, thresholdDiscountMinor: 2000 }, 12000), 2000);
});

test("eligibility respects country/route scope and use window", () => {
  const c = { status: "active", eligibleCountries: ["US"], eligibleRouteCodes: ["SF-US"], discountType: "fixed", useEndsAt: "2026-03-20T00:00:00.000Z" };
  assert.equal(isCouponEligible(c, { country: "US", routeCode: "SF-US", nowMs: NOW }).eligible, true);
  assert.equal(isCouponEligible(c, { country: "GB", routeCode: "SF-US", nowMs: NOW }).eligible, false);
  assert.equal(isCouponEligible(c, { country: "US", routeCode: "OTHER", nowMs: NOW }).eligible, false);
  assert.equal(isCouponEligible(c, { country: "US", routeCode: "SF-US", nowMs: Date.parse("2026-04-01") }).reason, "expired");
});

function build() {
  const repository = new MemoryCouponRepository();
  const svc = createCouponService({ repository, clock: () => NOW });
  return { repository, svc };
}

async function activeCoupon(svc, over = {}) {
  const res = await svc.createCoupon(ADMIN, CAMPAIGN, { code: "SHIP5", discount_type: "fixed", fixed_value_minor: 500, per_user_limit: 1, total_quota: 2, eligible_countries: ["US"], use_ends_at: "2026-12-01T00:00:00.000Z", ...over });
  await svc.publishCoupon(ADMIN, CAMPAIGN, res.coupon.id);
  return res.coupon;
}

// ---- V2-10-02 frozen rules ----
test("an active coupon's key rules are frozen; only quota/limits change", async () => {
  const { svc } = build();
  const c = await activeCoupon(svc);
  await assert.rejects(() => svc.updateCoupon(ADMIN, CAMPAIGN, c.id, { fixed_value_minor: 9999 }), (e) => e.statusCode === 409);
  const upd = await svc.updateCoupon(ADMIN, CAMPAIGN, c.id, { total_quota: 100 });
  assert.equal(upd.coupon.total_quota, 100);
});

// ---- V2-10-03 grant/redeem quota + idempotency ----
test("grant enforces per-user limit and total quota atomically; redeem is idempotent", async () => {
  const { svc } = build();
  const c = await activeCoupon(svc);
  assert.equal((await svc.redeemCode(U1, { coupon_code: "SHIP5" })).granted, true);
  // Same user redeeming again → idempotent no-op (never a second grant).
  assert.equal((await svc.redeemCode(U1, { coupon_code: "SHIP5" })).granted, false);
  assert.equal((await svc.redeemCode(U2, { coupon_code: "SHIP5" })).granted, true);
  // Quota is 2 → a third distinct user is refused with 409.
  await assert.rejects(() => svc.redeemCode({ id: "33333333-3333-3333-3333-333333333333" }, { coupon_code: "SHIP5" }), (e) => e.statusCode === 409);
});

test("signup auto-grant is idempotent per user+coupon", async () => {
  const { svc } = build();
  await activeCoupon(svc);
  const first = await svc.autoGrantOnSignup(U1.id, "SHIP5");
  const again = await svc.autoGrantOnSignup(U1.id, "SHIP5");
  assert.equal(first.granted, true);
  assert.equal(again.granted, false); // idempotent
});

// ---- V2-10-04 reserve / settle / release (one coupon per parcel) ----
test("reserve locks one coupon to one parcel; settle uses it, release frees it", async () => {
  const { svc } = build();
  await activeCoupon(svc);
  await svc.redeemCode(U1, { coupon_code: "SHIP5" });

  const r = await svc.reserveForParcel(U1.id, { couponCode: "SHIP5", parcelId: "p1", country: "US", routeCode: "SF-US", shippingMinor: 8000 });
  assert.equal(r.discount_minor, 500);
  // A second coupon cannot reserve the same parcel.
  await svc.redeemCode(U2, { coupon_code: "SHIP5" });
  await assert.rejects(() => svc.reserveForParcel(U2.id, { couponCode: "SHIP5", parcelId: "p1", country: "US", routeCode: "SF-US", shippingMinor: 8000 }), (e) => e.statusCode === 409);

  await svc.settleForParcel("p1");
  const mine = (await svc.listMyCoupons(U1)).coupons;
  assert.equal(mine[0].status, "used");
});

test("releasing a parcel returns the coupon to available", async () => {
  const { svc } = build();
  await activeCoupon(svc);
  await svc.redeemCode(U1, { coupon_code: "SHIP5" });
  await svc.reserveForParcel(U1.id, { couponCode: "SHIP5", parcelId: "p2", country: "US", routeCode: "SF-US", shippingMinor: 8000 });
  await svc.releaseForParcel("p2");
  assert.equal((await svc.listMyCoupons(U1)).coupons[0].status, "available");
});
