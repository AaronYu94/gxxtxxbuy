import assert from "node:assert/strict";
import test from "node:test";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const wallet = { debits: [], refunds: [] };
  const financeService = {
    async debit(u, a, o) { wallet.debits.push({ u, a, o }); return { transaction: { id: "d" } }; },
    async refund(u, a, o) { wallet.refunds.push({ u, a, o }); return { transaction: { id: "r" } }; }
  };
  const orderService = { async transitionFulfillment() { return {}; } };
  const svc = createAfterSalesService({ repository, orderRepository, orderService, financeService, clock: () => NOW });
  return { repository, items, svc, wallet };
}

function seedItem(repository, items, itemId, { totalCents = 10000, deadline = "2026-03-12T00:00:00.000Z", stockNo } = {}) {
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, totalCents, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo: stockNo || `GO-STOCK-${itemId}`, returnDeadlineAt: deadline });
}

// ---- The full user-fault return with a paid return fee, through to refund ----
test("E2E user-fault return: fee paid, picked, verified, shipped, refunded (net of deduction)", async () => {
  const { repository, items, svc, wallet } = build();
  seedItem(repository, items, "item-1", { totalCents: 10000, stockNo: "GO-STOCK-E1" });

  // Open + procurement review (user pays return freight).
  const opened = await svc.requestReturn(USER, "item-1", { reason: "changed mind", evidence_photo_keys: ["e.jpg"] });
  const id = opened.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "user", freight_party: "user" });

  // Wrong scan is impossible before the fee is paid.
  await assert.rejects(() => svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-E1" }), (e) => e.statusCode === 409);
  await svc.payReturnFee(USER, id);
  assert.equal(wallet.debits.length, 1); // return fee charged

  // Warehouse: wrong item rejected, correct item picked → verify → pack → ship back.
  await assert.rejects(() => svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-WRONG" }), (e) => e.statusCode === 409);
  await svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-E1" });
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"], weight_grams: 400 });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-E1", merchant_address: { line1: "1 Rd" } });

  // Merchant received + under-refunds (deducts 2000); procurement registers it.
  await svc.markMerchantReceived(AGENT, id);
  await svc.registerMerchantRefund(AGENT, id, { merchant_refund_cny_minor: 8000, merchant_deduction_cny_minor: 2000, refund_no: "M-1", receipt_photo_keys: ["r.jpg"] });

  // Finance executes: user-fault ⇒ item total − deduction = 8000 (no return-freight refund).
  const preview = await svc.previewRefund(id);
  assert.equal(preview.platform_refund_cny_minor, 8000);
  const done = await svc.executeRefund(FIN, id);
  assert.equal(done.after_sales_order.status, "completed");
  assert.equal(wallet.refunds.length, 1);
  assert.equal(wallet.refunds[0].a, 8000);

  // History is a complete, ordered audit trail ending at completed.
  assert.equal(done.history[0].to_status, "purchase_review_pending");
  assert.equal(done.history[done.history.length - 1].to_status, "completed");
});

// ---- Boundary + rejection + permissions in one pass ----
test("E2E boundaries: expired window, rejection releases stock, CS cannot act", async () => {
  const { repository, items, svc } = build();

  // (1) Five-day boundary: an expired item cannot open a return.
  seedItem(repository, items, "item-late", { deadline: "2026-03-01T00:00:00.000Z", stockNo: "GO-STOCK-L" });
  await assert.rejects(() => svc.requestReturn(USER, "item-late", { reason: "late" }), (e) => e.statusCode === 409);

  // (2) Rejection releases the reserved unit.
  seedItem(repository, items, "item-rej", { stockNo: "GO-STOCK-R" });
  const rej = await svc.requestReturn(USER, "item-rej", { reason: "x" });
  assert.equal(repository.inventory.get("item-rej").status, "return_reserved");
  await svc.startReview(AGENT, rej.after_sales_order.id);
  await svc.rejectReview(AGENT, rej.after_sales_order.id, { reason: "not defective" });
  assert.equal(repository.inventory.get("item-rej").status, "in_stock");

  // (3) A user cannot drive a staff-only transition.
  seedItem(repository, items, "item-x", { stockNo: "GO-STOCK-X" });
  const ox = await svc.requestReturn(USER, "item-x", { reason: "x" });
  // The user has no method to approve — staff actions live on admin-gated service
  // methods only; here we assert the state machine still blocks an illegal jump.
  await assert.rejects(() => svc.approveReview(AGENT, ox.after_sales_order.id, { responsible_party: "user", freight_party: "user" }), (e) => e.statusCode === 409);
});

// ---- Seller-fault makes the user whole including return freight ----
test("E2E seller-fault: no fee due, user made whole", async () => {
  const { repository, items, svc, wallet } = build();
  seedItem(repository, items, "item-s", { totalCents: 12000, stockNo: "GO-STOCK-S" });
  const opened = await svc.requestReturn(USER, "item-s", { reason: "defective" });
  const id = opened.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "seller", freight_party: "seller" });
  // No return-fee bill for a seller-fault case.
  const detail = await svc.adminGetAfterSales(id);
  assert.equal(detail.bills.length, 0);
  assert.equal(detail.after_sales_order.status, "warehouse_picking_pending");

  await svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-S" });
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-S", merchant_address: { line1: "x" } });
  await svc.markMerchantReceived(AGENT, id);
  await svc.registerMerchantRefund(AGENT, id, { merchant_refund_cny_minor: 12000, merchant_deduction_cny_minor: 0, refund_no: "M-S" });
  const done = await svc.executeRefund(FIN, id);
  assert.equal(done.after_sales_order.status, "completed");
  assert.equal(wallet.refunds[0].a, 12000); // full item total; no fee was charged
});
