import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { isAllowedTransition } from "../src/orders/order-status.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const SYSTEM = { type: "system" };
const BUYER = { type: "admin", id: "22222222-2222-2222-2222-222222222222", role: "purchasing_agent" };

async function seedItem() {
  const catalog = new MemoryCatalogRepository();
  const order = new MemoryOrderRepository();
  const service = createOrderService({ repository: order, catalogRepository: catalog });
  const snapshot = await catalog.createSnapshot({
    userId: USER.id, platform: "Taobao", sourceUrl: "https://item.taobao.com/item.htm?id=1",
    title: "Sneaker", priceCents: 19990, currency: "CNY", domesticShippingCents: 600, source: "manual"
  });
  const { order: created } = await service.createOrder(USER, {
    submit_key: "k", items: [{ snapshot_id: snapshot.id, quantity: 1 }]
  });
  return { service, order, itemId: created.items[0].id };
}

test("pure transition table matches the frozen V2-00-06 machine", () => {
  assert.equal(isAllowedTransition("fulfillment", "pending_payment", "agent_ordering"), true);
  assert.equal(isAllowedTransition("fulfillment", "pending_payment", "arrived"), false);
  assert.equal(isAllowedTransition("fulfillment", "completed", "cancelled"), false); // terminal
  assert.equal(isAllowedTransition("exception", "none", "price_change_pending"), true);
  assert.equal(isAllowedTransition("exception", "refund_pending", "none"), false);
});

test("a legal transition advances status and appends a history row", async () => {
  const { service, itemId } = await seedItem();
  const result = await service.transitionFulfillment(SYSTEM, itemId, { to: "agent_ordering", action: "payment_settled" });
  assert.equal(result.item.fulfillment_status, "agent_ordering");
  const { history } = await service.getItemHistory(itemId);
  assert.equal(history.length, 1);
  assert.equal(history[0].from_status, "pending_payment");
  assert.equal(history[0].to_status, "agent_ordering");
  assert.equal(history[0].action, "payment_settled");
  assert.equal(history[0].actor_type, "system");
});

test("an illegal crossing is rejected with 409 and records nothing", async () => {
  const { service, itemId } = await seedItem();
  await assert.rejects(
    () => service.transitionFulfillment(BUYER, itemId, { to: "arrived", action: "skip_ahead" }),
    (error) => error.statusCode === 409
  );
  const { history, item } = await service.getItemHistory(itemId);
  assert.equal(history.length, 0);
  assert.equal(item.fulfillment_status, "pending_payment");
});

test("the same idempotency key is a no-op replay, not a second transition", async () => {
  const { service, itemId } = await seedItem();
  const first = await service.transitionFulfillment(SYSTEM, itemId, { to: "agent_ordering", action: "payment_settled", idempotency_key: "pay-1" });
  assert.equal(first.replay, false);
  const second = await service.transitionFulfillment(SYSTEM, itemId, { to: "agent_ordering", action: "payment_settled", idempotency_key: "pay-1" });
  assert.equal(second.replay, true);
  const { history } = await service.getItemHistory(itemId);
  assert.equal(history.length, 1); // still one row
});

test("re-applying after the status already moved is a 409 (guards concurrent 接单)", async () => {
  const { service, itemId } = await seedItem();
  await service.transitionFulfillment(SYSTEM, itemId, { to: "agent_ordering", action: "payment_settled" });
  // A second actor still thinks it is pending_payment → the from-check rejects it.
  await assert.rejects(
    () => service.transitionFulfillment(SYSTEM, itemId, { to: "agent_ordering", action: "payment_settled" }),
    (error) => error.statusCode === 409
  );
});

test("exception overlay transitions independently of fulfillment", async () => {
  const { service, itemId } = await seedItem();
  const flagged = await service.transitionException(BUYER, itemId, { to: "price_change_pending", action: "price_increase", reason: "1688 raised" });
  assert.equal(flagged.item.exception_status, "price_change_pending");
  assert.equal(flagged.item.fulfillment_status, "pending_payment"); // untouched
  const cleared = await service.transitionException(BUYER, itemId, { to: "none", action: "surcharge_paid" });
  assert.equal(cleared.item.exception_status, "none");
  const { history } = await service.getItemHistory(itemId);
  assert.equal(history.length, 2);
  assert.ok(history.every((row) => row.field === "exception"));
});
