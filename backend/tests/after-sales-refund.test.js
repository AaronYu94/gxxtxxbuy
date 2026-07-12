import assert from "node:assert/strict";
import test from "node:test";
import { computePlatformRefund } from "../src/after_sales/refund-accounting.js";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

// ---- V2-08-11 pure accounting ----
test("seller-fault refund makes the user whole incl. return freight", () => {
  const r = computePlatformRefund({ itemTotalMinor: 10000, responsibleParty: "seller", merchantDeductionMinor: 500, userPaidReturnFeeMinor: 1700 });
  assert.equal(r.platform_refund_cny_minor, 11700); // item + return freight; deduction absorbed by platform
});

test("user-fault refund subtracts the merchant deduction and refunds no freight", () => {
  const r = computePlatformRefund({ itemTotalMinor: 10000, responsibleParty: "user", merchantDeductionMinor: 1500, userPaidReturnFeeMinor: 1700 });
  assert.equal(r.platform_refund_cny_minor, 8500);
});

test("a refund is never negative", () => {
  const r = computePlatformRefund({ itemTotalMinor: 1000, responsibleParty: "user", merchantDeductionMinor: 5000 });
  assert.equal(r.platform_refund_cny_minor, 0);
});

// ---- V2-08-10/12 chain over the service ----
function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const wallet = { refunds: [], debits: [] };
  const financeService = {
    async debit(u, a, o) { wallet.debits.push({ u, a, o }); return { transaction: { id: "tx" } }; },
    async refund(u, a, o) { wallet.refunds.push({ u, a, o }); return { transaction: { id: "rx" } }; }
  };
  const coupon = { calls: [] };
  const couponService = { async restoreForAfterSales(u, o) { coupon.calls.push({ u, o }); } };
  const svc = createAfterSalesService({ repository, orderRepository, financeService, couponService, clock: () => NOW });
  return { repository, items, svc, wallet, coupon };
}

// Seller-fault path all the way to platform_refund_pending.
async function toPlatformRefund(svc, repository, items, { totalCents = 10000 } = {}) {
  const itemId = "item-1";
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, totalCents, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo: "GO-STOCK-RF", returnDeadlineAt: "2026-03-12T00:00:00.000Z" });
  const res = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  const id = res.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "seller", freight_party: "seller" });
  await svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-RF" });
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-1", merchant_address: { line1: "x" } });
  await svc.markMerchantReceived(AGENT, id);
  return id;
}

test("merchant refund cannot exceed the refundable amount", async () => {
  const { repository, items, svc } = build();
  const id = await toPlatformRefund(svc, repository, items, { totalCents: 10000 });
  await assert.rejects(
    () => svc.registerMerchantRefund(AGENT, id, { merchant_refund_cny_minor: 20000, merchant_deduction_cny_minor: 0, refund_no: "R1" }),
    (e) => e.statusCode === 400
  );
});

test("full seller-fault chain refunds the wallet once and completes", async () => {
  const { repository, items, svc, wallet, coupon } = build();
  const id = await toPlatformRefund(svc, repository, items, { totalCents: 10000 });
  await svc.registerMerchantRefund(AGENT, id, { merchant_refund_cny_minor: 9500, merchant_deduction_cny_minor: 500, refund_no: "R1", receipt_photo_keys: ["r.jpg"] });

  const preview = await svc.previewRefund(id);
  assert.equal(preview.platform_refund_cny_minor, 10000); // seller-fault, no return fee paid

  const done = await svc.executeRefund(FIN, id);
  assert.equal(done.after_sales_order.status, "completed");
  assert.equal(wallet.refunds.length, 1);
  assert.equal(wallet.refunds[0].a, 10000);
  assert.equal(coupon.calls.length, 1); // coupon restore seam fired

  // Idempotent: a second execute does not double-refund.
  await svc.executeRefund(FIN, id);
  assert.equal(wallet.refunds.length, 1);
});

test("refund cannot be executed before the merchant refund is registered", async () => {
  const { repository, items, svc } = build();
  const id = await toPlatformRefund(svc, repository, items);
  // Still merchant_refund_pending → execute refused.
  await assert.rejects(() => svc.executeRefund(FIN, id), (e) => e.statusCode === 409);
});
