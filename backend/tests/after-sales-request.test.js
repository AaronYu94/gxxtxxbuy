import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReturnEligibility } from "../src/after_sales/after-sales-eligibility.js";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const OTHER = { id: "22222222-2222-2222-2222-222222222222" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

// ---- V2-08-02 pure eligibility ----
test("eligibility: warehoused + within window is eligible", () => {
  const r = evaluateReturnEligibility({ inventory: { status: "in_stock", returnDeadlineAt: "2026-03-12T00:00:00.000Z" }, nowMs: NOW });
  assert.equal(r.eligible, true);
});

test("eligibility: past the 5-day window is rejected", () => {
  const r = evaluateReturnEligibility({ inventory: { status: "in_stock", returnDeadlineAt: "2026-03-09T00:00:00.000Z" }, nowMs: NOW });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "window_expired");
});

test("eligibility: a reserved/outbound unit is not available", () => {
  const r = evaluateReturnEligibility({ inventory: { status: "reserved", returnDeadlineAt: "2026-03-12T00:00:00.000Z" }, nowMs: NOW });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "not_available");
});

test("eligibility: an open after-sales order blocks a new one", () => {
  const r = evaluateReturnEligibility({ inventory: { status: "in_stock", returnDeadlineAt: "2026-03-12T00:00:00.000Z" }, hasOpenAfterSales: true, nowMs: NOW });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "after_sales_open");
});

// ---- V2-08-03 user request over the service ----
function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const svc = createAfterSalesService({ repository, orderRepository, clock: () => NOW });
  return { repository, items, svc };
}

function seedItem(repository, items, { itemId = "item-1", userId = USER.id, quantity = 1, deadline = "2026-03-12T00:00:00.000Z" } = {}) {
  items.set(itemId, { id: itemId, userId, quantity, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId, returnDeadlineAt: deadline });
  return itemId;
}

test("a user opens a return, reserving the unit and recording history", async () => {
  const { repository, items, svc } = build();
  const itemId = seedItem(repository, items);
  const res = await svc.requestReturn(USER, itemId, { reason: "damaged", description: "broken", evidence_photo_keys: ["e1.jpg"] });
  assert.equal(res.after_sales_order.status, "purchase_review_pending");
  assert.equal(res.after_sales_order.reason, "damaged");
  assert.equal(res.attachments[0].kind, "evidence");
  assert.equal(res.history[0].to_status, "purchase_review_pending");
  // The unit is now reserved for return.
  assert.equal(repository.inventory.get(itemId).status, "return_reserved");
});

test("a duplicate request returns the existing open order (no second reservation)", async () => {
  const { repository, items, svc } = build();
  const itemId = seedItem(repository, items);
  const first = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  const again = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  assert.equal(again.after_sales_order.id, first.after_sales_order.id);
  assert.equal(repository.orders.size, 1);
});

test("an expired window is refused", async () => {
  const { repository, items, svc } = build();
  const itemId = seedItem(repository, items, { deadline: "2026-03-01T00:00:00.000Z" });
  await assert.rejects(() => svc.requestReturn(USER, itemId, { reason: "late" }), (e) => e.statusCode === 409);
});

test("another user cannot return someone else's item", async () => {
  const { repository, items, svc } = build();
  const itemId = seedItem(repository, items);
  await assert.rejects(() => svc.requestReturn(OTHER, itemId, { reason: "x" }), (e) => e.statusCode === 404);
});

test("return quantity cannot exceed the ordered quantity", async () => {
  const { repository, items, svc } = build();
  const itemId = seedItem(repository, items, { quantity: 2 });
  await assert.rejects(() => svc.requestReturn(USER, itemId, { reason: "x", quantity: 3 }), (e) => e.statusCode === 400);
});
