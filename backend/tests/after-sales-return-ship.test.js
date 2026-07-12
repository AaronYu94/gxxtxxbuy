import assert from "node:assert/strict";
import test from "node:test";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const financeService = { async debit() { return { transaction: { id: "tx" } }; } };
  const svc = createAfterSalesService({ repository, orderRepository, financeService, clock: () => NOW });
  return { repository, items, svc };
}

// Drive an order to return_verifying.
async function toVerifying(svc, repository, items, itemId = "item-1", stockNo = "GO-STOCK-RS") {
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo, returnDeadlineAt: "2026-03-12T00:00:00.000Z" });
  const res = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  const id = res.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "seller", freight_party: "seller" });
  await svc.scanReturnPick(OP, id, { stock_no: stockNo });
  return id;
}

test("a matching verification packs; ship-back records tracking and advances", async () => {
  const { repository, items, svc } = build();
  const id = await toVerifying(svc, repository, items);
  const verified = await svc.verifyReturn(OP, id, { photo_keys: ["q1.jpg"], quantity_matched: true, spec_matched: true, weight_grams: 500 });
  assert.equal(verified.after_sales_order.status, "return_packing");
  assert.equal(verified.inspection.weight_grams, 500);

  const packed = await svc.packReturn(OP, id, { photo_keys: ["pack.jpg"] });
  assert.equal(packed.after_sales_order.status, "merchant_return_pending");

  const shipped = await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-123", merchant_address: { name: "Store", line1: "1 Rd" } });
  assert.equal(shipped.after_sales_order.status, "returned_to_merchant");
  assert.equal(shipped.shipment.tracking_no, "RT-123");
  assert.equal(shipped.shipment.merchant_address_snapshot.name, "Store");
});

test("verification photos are required", async () => {
  const { repository, items, svc } = build();
  const id = await toVerifying(svc, repository, items);
  await assert.rejects(() => svc.verifyReturn(OP, id, { photo_keys: [] }), (e) => e.statusCode === 400);
});

test("a quantity/spec mismatch routes to the exception state", async () => {
  const { repository, items, svc } = build();
  const id = await toVerifying(svc, repository, items);
  const verified = await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"], quantity_matched: false });
  assert.equal(verified.after_sales_order.status, "exception");
  // An exception can be routed back to a legal node.
  const resolved = await svc.resolveException(OP, id, { to_status: "return_packing" });
  assert.equal(resolved.after_sales_order.status, "return_packing");
});

test("a duplicate tracking number is rejected", async () => {
  const { repository, items, svc } = build();
  const id1 = await toVerifying(svc, repository, items, "item-1", "GO-STOCK-A");
  await svc.verifyReturn(OP, id1, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id1, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id1, { carrier: "SF", tracking_no: "DUP-1", merchant_address: { line1: "x" } });

  const id2 = await toVerifying(svc, repository, items, "item-2", "GO-STOCK-B");
  await svc.verifyReturn(OP, id2, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id2, { photo_keys: ["p.jpg"] });
  await assert.rejects(
    () => svc.shipBackToMerchant(OP, id2, { carrier: "SF", tracking_no: "DUP-1", merchant_address: { line1: "y" } }),
    (e) => e.statusCode === 409
  );
});

test("ship-back requires a merchant address", async () => {
  const { repository, items, svc } = build();
  const id = await toVerifying(svc, repository, items);
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await assert.rejects(() => svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "T", merchant_address: {} }), (e) => e.statusCode === 400);
});

test("a rejection event after ship-back raises the order exception", async () => {
  const { repository, items, svc } = build();
  const id = await toVerifying(svc, repository, items);
  await svc.verifyReturn(OP, id, { photo_keys: ["q.jpg"] });
  await svc.packReturn(OP, id, { photo_keys: ["p.jpg"] });
  await svc.shipBackToMerchant(OP, id, { carrier: "SF", tracking_no: "RT-9", merchant_address: { line1: "x" } });
  const after = await svc.recordShipmentEvent(AGENT, id, { type: "rejected", note: "merchant refused" });
  assert.equal(after.after_sales_order.status, "exception");
  assert.equal(after.shipment.status, "rejected");
});
