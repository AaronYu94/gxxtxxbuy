import assert from "node:assert/strict";
import test from "node:test";
import { computeBilling } from "../src/consolidation/billing.js";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";
import { createCouponService } from "../src/promo/coupon-service.js";
import { MemoryCouponRepository } from "./helpers/memory-coupon-repository.js";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

// ---- V2-12-15 E2E-05 仓库防错 ----
test("E2E-05: wrong item is rejected from a parcel; a duplicate scan never double-picks", async () => {
  const repo = new MemoryConsolidationRepository();
  const finance = { async debit() { return { transaction: { id: "t" } }; }, async refund() { return { transaction: { id: "r" } }; } };
  const svc = createConsolidationService({ repository: repo, financeService: finance });
  repo.seedInventory({ stockNo: "GO-STOCK-W1", userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: ["GO-STOCK-W1"] });
  const id = created.parcel.id;
  await svc.submitParcel(USER, id, {});
  await svc.payPackingBill(USER, id);
  await svc.acceptForPicking(OP, id);
  // A wrong item cannot be scanned into the parcel.
  await assert.rejects(() => svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-NOT-MINE" }), (e) => e.statusCode === 409);
  // The correct item scans; a duplicate scan is idempotent (no double pick).
  const first = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-W1" });
  const dup = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-W1" });
  assert.equal(first.picked, 1);
  assert.equal(dup.replay, true);
  assert.equal(dup.picked, 1);
});

// ---- V2-12-16 E2E-06 包裹取消 ----
test("E2E-06: cancel before packing refunds + releases; after packing starts it is forbidden", async () => {
  const repo = new MemoryConsolidationRepository();
  const wallet = { refunds: [] };
  const finance = { async debit() { return { transaction: { id: "t" } }; }, async refund(u, a) { wallet.refunds.push(a); return { transaction: { id: "r" } }; } };
  const svc = createConsolidationService({ repository: repo, financeService: finance });
  repo.seedInventory({ stockNo: "GO-STOCK-C1", userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: ["GO-STOCK-C1"] });
  const id = created.parcel.id;
  await svc.submitParcel(USER, id, {});
  await svc.payPackingBill(USER, id);
  // Cancel before packing → stock released + paid fee refunded.
  const cancelled = await svc.cancelParcel(USER, id);
  assert.equal(cancelled.parcel.status, "cancelled");
  assert.equal(repo.inventory.get("GO-STOCK-C1").status, "in_stock");
  assert.equal(wallet.refunds.length, 1);

  // A second parcel taken all the way into packing cannot be cancelled.
  repo.seedInventory({ stockNo: "GO-STOCK-C2", userId: USER.id });
  const p2 = (await svc.createParcel(USER, { stock_nos: ["GO-STOCK-C2"] })).parcel.id;
  await svc.submitParcel(USER, p2, {});
  await svc.payPackingBill(USER, p2);
  await svc.acceptForPicking(OP, p2);
  await svc.scanPickItem(OP, p2, { stock_no: "GO-STOCK-C2" });
  await svc.startPacking(OP, p2);
  await assert.rejects(() => svc.cancelParcel(USER, p2), (e) => e.statusCode === 409);
});

// ---- V2-12-17 E2E-07 优惠与会员 ----
test("E2E-07: discount order is membership then one coupon; a refund restores the coupon", async () => {
  // Discount order: membership 10% off first, then a fixed coupon on the remainder.
  const billing = computeBilling({ subtotalMinor: 10000, membership: { discountBps: 1000 }, coupon: { type: "fixed", valueMinor: 2000 } });
  assert.equal(billing.membership_discount_cny_minor, 1000); // membership applied first
  assert.equal(billing.coupon_discount_cny_minor, 2000);
  assert.equal(billing.total_cny_minor, 7000);

  // A coupon reserved to a parcel is released back to available on a refund/cancel.
  const repo = new MemoryCouponRepository();
  const coupons = createCouponService({ repository: repo, clock: () => NOW });
  const c = (await coupons.createCoupon(AGENT, ["campaign_operator"], { code: "SHIP5", discount_type: "fixed", fixed_value_minor: 500, per_user_limit: 1 })).coupon;
  await coupons.publishCoupon(AGENT, ["campaign_operator"], c.id);
  await coupons.redeemCode(USER, { coupon_code: "SHIP5" });
  await coupons.reserveForParcel(USER.id, { couponCode: "SHIP5", parcelId: "p1", shippingMinor: 8000 });
  assert.equal((await coupons.listMyCoupons(USER)).coupons[0].status, "reserved");
  // Refund/cancel path → coupon returns to available (its remaining validity intact).
  await coupons.releaseForParcel("p1");
  assert.equal((await coupons.listMyCoupons(USER)).coupons[0].status, "available");
});

// ---- V2-12-18 E2E-08 退货 ----
test("E2E-08: five-day return — review, pick, verify, ship back, merchant + wallet refund", async () => {
  const repo = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const wallet = { refunds: [] };
  const financeService = { async debit() { return { transaction: { id: "t" } }; }, async refund(u, a) { wallet.refunds.push(a); return { transaction: { id: "r" } }; } };
  const svc = createAfterSalesService({ repository: repo, orderRepository, financeService, clock: () => NOW });

  const itemId = "item-1";
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, totalCents: 10000, fulfillmentStatus: "warehoused" });
  repo.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo: "GO-STOCK-R1", returnDeadlineAt: "2026-03-12T00:00:00.000Z" }); // within 5 days
  const opened = await svc.requestReturn(USER, itemId, { reason: "defective" });
  const id = opened.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "seller", freight_party: "seller" }); // seller-fault → no user fee
  await svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-R1" });
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-8", merchant_address: { line1: "1 Rd" } });
  await svc.markMerchantReceived(AGENT, id);
  await svc.registerMerchantRefund(AGENT, id, { merchant_refund_cny_minor: 10000, merchant_deduction_cny_minor: 0, refund_no: "M-1" });
  const done = await svc.executeRefund(FIN, id);
  // Multi-role states end at completed; the user's wallet is refunded the item total.
  assert.equal(done.after_sales_order.status, "completed");
  assert.equal(wallet.refunds[0], 10000);
});
