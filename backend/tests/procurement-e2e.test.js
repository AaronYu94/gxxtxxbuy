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

function stack() {
  const clockState = { ms: Date.parse("2026-07-10T00:00:00.000Z") };
  const orderRepo = new MemoryOrderRepository();
  const procurementRepo = new MemoryProcurementRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: procurementRepo, orderRepository: orderRepo });
  const orders = createOrderService({
    repository: orderRepo, catalogRepository: catalog, clock: () => clockState.ms,
    accountPicker: (p) => procurement.pickAccountForPlatform(p)
  });
  return { orders, procurement, catalog, clockState };
}

let seed = 900;
async function snapshot(catalog, userId, platform, priceCents = 1000) {
  return catalog.createSnapshot({
    userId, platform, sourceUrl: `https://x/${platform}/${seed++}`, title: "P",
    priceCents, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
}

test("E2E-01 normal procurement: paid → assigned → claimed → confirmed → dispatched", async () => {
  const { orders, procurement, catalog } = stack();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const s1 = await snapshot(catalog, USER.id, "Taobao");
  const s2 = await snapshot(catalog, USER.id, "Taobao");
  const { order } = await orders.createOrder(USER, { submit_key: "e2e1", items: [
    { snapshot_id: s1.id, quantity: 1 }, { snapshot_id: s2.id, quantity: 1 }
  ] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "p1" });

  for (const it of order.items) {
    await procurement.claimTask(BUYER, it.id);
    await procurement.confirmPurchase(BUYER, it.id, { actual_platform: "Taobao", actual_order_no: `O${it.id}`, quantity: 1, cost: 9 });
    await orders.registerDispatch(ADMIN, it.id, { carrier: "SF", tracking_no: `T${it.id}` });
  }

  const detail = await procurement.getTaskDetail(order.items[0].id);
  assert.equal(detail.task.fulfillment_status, "seller_dispatched");
  assert.ok(detail.confirmation);
  const actions = detail.timeline.map((t) => t.action);
  assert.ok(actions.includes("payment_settled") && actions.includes("claim") && actions.includes("confirm_purchase") && actions.includes("register_dispatch"));
});

test("E2E-02 1688 price increase: surcharge → user pays → continues to dispatch", async () => {
  const { orders, procurement, catalog } = stack();
  await procurement.createAccount(ADMIN, { platform: "1688", label: "M", role: "default" });
  const s = await snapshot(catalog, USER.id, "1688", 2000);
  const { order } = await orders.createOrder(USER, { submit_key: "e2e2", items: [{ snapshot_id: s.id, quantity: 2 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "p2" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);

  const raised = await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 2500 });
  assert.equal(raised.exception.surcharge_cents, (2500 - 2000) * 2); // 1000
  const paid = await orders.respondException(USER, itemId, { choice: "pay_surcharge" });
  assert.equal(paid.item.exception_status, "none");
  assert.equal(paid.item.fulfillment_status, "purchasing"); // continues

  const confirmed = await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "1688", actual_order_no: "O1", quantity: 2, cost: 50 });
  assert.equal(confirmed.task.fulfillment_status, "seller_dispatch_pending");
});

test("E2E-03 partial stockout cancel: one item cancels, the other proceeds; parent keeps both", async () => {
  const { orders, procurement, catalog } = stack();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const s1 = await snapshot(catalog, USER.id, "Taobao");
  const s2 = await snapshot(catalog, USER.id, "Taobao");
  const { order } = await orders.createOrder(USER, { submit_key: "e2e3", items: [
    { snapshot_id: s1.id, quantity: 1 }, { snapshot_id: s2.id, quantity: 1 }
  ] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "p3" });
  const [a, b] = order.items;
  await procurement.claimTask(BUYER, a.id);
  await procurement.claimTask(BUYER, b.id);

  // Item A is out of stock → user cancels it.
  await orders.raiseAvailability(ADMIN, a.id, { reason: "sold out" });
  const cancelled = await orders.respondException(USER, a.id, { choice: "cancel" });
  assert.equal(cancelled.item.fulfillment_status, "cancelled");

  // Item B proceeds normally.
  await procurement.confirmPurchase(BUYER, b.id, { actual_platform: "Taobao", actual_order_no: "OB", quantity: 1, cost: 9 });

  const view = await orders.getOrder(USER, order.id);
  assert.equal(view.order.item_count, 2); // both items still belong to the parent
  const statuses = view.order.items.map((i) => i.fulfillment_status).sort();
  assert.deepEqual(statuses, ["cancelled", "seller_dispatch_pending"]);
});

test("E2E-04 24h timeout: unresponded exception auto-cancels the item", async () => {
  const { orders, procurement, catalog, clockState } = stack();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const s = await snapshot(catalog, USER.id, "Taobao");
  const { order } = await orders.createOrder(USER, { submit_key: "e2e4", items: [{ snapshot_id: s.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "p4" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1200 });

  clockState.ms += 25 * 3600 * 1000;
  const swept = await orders.autoCancelExpiredExceptions({});
  assert.equal(swept.cancelled, 1);
  const detail = await procurement.getTaskDetail(itemId);
  assert.equal(detail.task.fulfillment_status, "cancelled");
});

test("E2E-05 role gating: SELF vs ORG scope, and terminal correction needs super_admin", async () => {
  const { orders, procurement, catalog } = stack();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const s = await snapshot(catalog, USER.id, "Taobao");
  const { order } = await orders.createOrder(USER, { submit_key: "e2e5", items: [{ snapshot_id: s.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "p5" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);

  // Data scope: the claiming buyer sees it under SELF; another buyer does not.
  assert.equal((await procurement.listTasks({ scope: "SELF", adminUserId: BUYER.id })).tasks.length, 1);
  assert.equal((await procurement.listTasks({ scope: "SELF", adminUserId: ADMIN.id })).tasks.length, 0);
  assert.equal((await procurement.listTasks({ scope: "ORG", adminUserId: ADMIN.id })).tasks.length, 1);

  // Controlled terminal correction requires super_admin.
  await assert.rejects(
    () => orders.controlledCorrection(BUYER, ["procurement_lead"], itemId, { to: "refunded" }),
    (e) => e.statusCode === 403
  );
  const forced = await orders.controlledCorrection(ADMIN, ["super_admin"], itemId, { to: "refunded", reason: "ops" });
  assert.equal(forced.item.fulfillment_status, "refunded");
});
