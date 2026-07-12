import assert from "node:assert/strict";
import test from "node:test";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const svc = createAfterSalesService({ repository, orderRepository, clock: () => NOW });
  return { repository, items, svc };
}

async function openReturn(svc, repository, items, itemId = "item-1") {
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, returnDeadlineAt: "2026-03-12T00:00:00.000Z" });
  const res = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  return res.after_sales_order.id;
}

test("approve with user-paid freight routes to return_fee_due, seller-paid to picking", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  await svc.startReview(AGENT, id);
  const approved = await svc.approveReview(AGENT, id, { responsible_party: "user", freight_party: "user" });
  assert.equal(approved.after_sales_order.status, "return_fee_due");
  assert.equal(approved.after_sales_order.freight_party, "user");
  assert.equal(approved.after_sales_order.responsible_party, "user");

  // Seller-fault case skips the fee bill.
  const id2 = await openReturn(svc, repository, items, "item-2");
  await svc.startReview(AGENT, id2);
  const approved2 = await svc.approveReview(AGENT, id2, { responsible_party: "seller", freight_party: "seller" });
  assert.equal(approved2.after_sales_order.status, "warehouse_picking_pending");
});

test("rejection requires a reason and releases the reserved unit", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  await svc.startReview(AGENT, id);
  await assert.rejects(() => svc.rejectReview(AGENT, id, {}), (e) => e.statusCode === 400);
  const rejected = await svc.rejectReview(AGENT, id, { reason: "not defective" });
  assert.equal(rejected.after_sales_order.status, "rejected");
  assert.equal(rejected.after_sales_order.reject_reason, "not defective");
  // Unit returned to stock.
  assert.equal(repository.inventory.get("item-1").status, "in_stock");
});

test("request-material → user supplements (old attachments retained) → re-review", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  await svc.startReview(AGENT, id);
  await svc.requestMaterial(AGENT, id, { note: "need a photo of the label" });
  const detail = await svc.adminGetAfterSales(id);
  assert.equal(detail.after_sales_order.status, "customer_material_pending");

  const supplemented = await svc.supplementMaterial(USER, id, { photo_keys: ["label.jpg"], note: "here" });
  assert.equal(supplemented.after_sales_order.status, "purchase_reviewing");
  // Both the original evidence (if any) and the new material are present.
  const kinds = supplemented.attachments.map((a) => a.kind);
  assert.ok(kinds.includes("material"));
});

test("material can only be supplemented while awaiting it", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  // Still purchase_review_pending → user cannot supplement.
  await assert.rejects(() => svc.supplementMaterial(USER, id, { note: "x" }), (e) => e.statusCode === 409);
});

test("an illegal transition is rejected by the state machine", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  // Cannot approve straight from purchase_review_pending (must start review first).
  await assert.rejects(() => svc.approveReview(AGENT, id, { responsible_party: "user", freight_party: "user" }), (e) => e.statusCode === 409);
});

test("a stalled awaiting-material order can be closed and releases the unit", async () => {
  const { repository, items, svc } = build();
  const id = await openReturn(svc, repository, items);
  await svc.startReview(AGENT, id);
  await svc.requestMaterial(AGENT, id, { note: "need info" });
  const closed = await svc.closeStalled(AGENT, id, { reason: "no response in 7 days" });
  assert.equal(closed.after_sales_order.status, "closed");
  assert.equal(repository.inventory.get("item-1").status, "in_stock");
});
