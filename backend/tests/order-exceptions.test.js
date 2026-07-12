import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };

// A purchasing item (paid, assigned, claimed) under a controllable clock.
async function purchasingItem({ quantity = 2, unitYuan = 10 } = {}) {
  const clockState = { ms: Date.parse("2026-07-10T00:00:00.000Z") };
  const clock = () => clockState.ms;
  const procurementRepo = new MemoryProcurementRepository();
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: procurementRepo, orderRepository: orderRepo });
  const orders = createOrderService({
    repository: orderRepo, catalogRepository: catalog, clock,
    accountPicker: (p) => procurement.pickAccountForPlatform(p)
  });
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "Main", role: "default" });
  const snapshot = await catalog.createSnapshot({
    userId: USER.id, platform: "Taobao", sourceUrl: "https://item.taobao.com/item.htm?id=1",
    title: "Sneaker", priceCents: unitYuan * 100, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order } = await orders.createOrder(USER, { submit_key: "k", items: [{ snapshot_id: snapshot.id, quantity }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  return { orders, itemId, clockState };
}

test("price increase computes the surcharge and pauses with price_change_pending", async () => {
  const { orders, itemId } = await purchasingItem({ quantity: 2, unitYuan: 10 }); // ordered unit 1000c
  const raised = await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1200 });
  assert.equal(raised.item.exception_status, "price_change_pending");
  assert.equal(raised.exception.surcharge_cents, (1200 - 1000) * 2); // (new−ordered)×qty = 400

  // Only one open exception at a time.
  await assert.rejects(() => orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1300 }), (e) => e.statusCode === 409);
});

test("paying the surcharge clears the exception; fulfillment stays purchasing", async () => {
  const { orders, itemId } = await purchasingItem();
  await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1200 });
  const resolved = await orders.respondException(USER, itemId, { choice: "pay_surcharge" });
  assert.equal(resolved.item.exception_status, "none");
  assert.equal(resolved.item.fulfillment_status, "purchasing");

  // A repeated click finds no open exception — no double effect.
  await assert.rejects(() => orders.respondException(USER, itemId, { choice: "pay_surcharge" }), (e) => e.statusCode === 404);
});

test("cancel resolves the exception and cancels the item's fulfillment", async () => {
  const { orders, itemId } = await purchasingItem();
  await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1200 });
  const cancelled = await orders.respondException(USER, itemId, { choice: "cancel" });
  assert.equal(cancelled.item.fulfillment_status, "cancelled");
  assert.equal(cancelled.exception.status, "cancelled");
});

test("availability exception offers wait/change/cancel and validates required fields", async () => {
  const { orders, itemId } = await purchasingItem();
  const raised = await orders.raiseAvailability(ADMIN, itemId, { reason: "sold out" });
  assert.equal(raised.item.exception_status, "availability_pending");

  await assert.rejects(() => orders.respondException(USER, itemId, { choice: "pay_surcharge" }), (e) => e.statusCode === 400); // invalid choice
  const changed = await orders.respondException(USER, itemId, { choice: "change_spec", spec: "Black / 44" });
  assert.equal(changed.item.exception_status, "none");
  const after = await orders.getItemException(USER, itemId);
  assert.equal(after.exception, null); // exception now closed; no open exception remains
});

test("a response after the deadline is rejected (409)", async () => {
  const { orders, itemId, clockState } = await purchasingItem();
  await orders.raiseAvailability(ADMIN, itemId, { reason: "sold out" });
  clockState.ms += 25 * 3600 * 1000; // 25h later — past the 24h deadline
  await assert.rejects(() => orders.respondException(USER, itemId, { choice: "wait" }), (e) => e.statusCode === 409);
});

test("24h auto-cancel expires unresponded exceptions and is idempotent", async () => {
  const { orders, itemId, clockState } = await purchasingItem();
  await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1200 });
  clockState.ms += 25 * 3600 * 1000;

  const first = await orders.autoCancelExpiredExceptions({});
  assert.equal(first.cancelled, 1);
  const { item } = await orders.getItemHistory(itemId);
  assert.equal(item.fulfillment_status, "cancelled");

  // Re-running finds nothing still open past deadline.
  const second = await orders.autoCancelExpiredExceptions({});
  assert.equal(second.cancelled, 0);
});
