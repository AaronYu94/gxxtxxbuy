import assert from "node:assert/strict";
import test from "node:test";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createOrderService } from "../src/orders/order-service.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER1 = { id: "66666666-6666-6666-6666-666666666666" };
const BUYER2 = { id: "77777777-7777-7777-7777-777777777777" };

async function setup() {
  const procurementRepo = new MemoryProcurementRepository();
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: procurementRepo, orderRepository: orderRepo });
  const orders = createOrderService({
    repository: orderRepo, catalogRepository: catalog,
    accountPicker: (p) => procurement.pickAccountForPlatform(p)
  });
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "Main", role: "default" });
  const snapshot = await catalog.createSnapshot({
    userId: USER.id, platform: "Taobao", sourceUrl: "https://item.taobao.com/item.htm?id=1",
    title: "Sneaker", priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order } = await orders.createOrder(USER, { submit_key: "k", items: [{ snapshot_id: snapshot.id, quantity: 3 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e" });
  const itemId = order.items[0].id;
  return { procurement, orders, orderRepo, itemId };
}

test("claiming moves an agent_ordering item to purchasing; a second claim loses (409)", async () => {
  const { procurement, itemId } = await setup();
  const claimed = await procurement.claimTask(BUYER1, itemId);
  assert.equal(claimed.task.fulfillment_status, "purchasing");
  assert.equal(claimed.task.claimed_by_admin_id, BUYER1.id);

  await assert.rejects(() => procurement.claimTask(BUYER2, itemId), (e) => e.statusCode === 409);
});

test("confirm-purchase records the real purchase and advances to seller_dispatch_pending", async () => {
  const { procurement, itemId } = await setup();
  await procurement.claimTask(BUYER1, itemId);

  const confirmed = await procurement.confirmPurchase(BUYER1, itemId, {
    actual_platform: "Taobao", actual_account: "shop-a", actual_order_no: "TB123",
    quantity: 2, cost: 9.9, shipping: 1, voucher_keys: ["private/vouchers/x.jpg"]
  });
  assert.equal(confirmed.task.fulfillment_status, "seller_dispatch_pending");
  assert.equal(confirmed.confirmation.quantity, 2);
  assert.equal(confirmed.confirmation.cost_cents, 990);
  assert.equal(confirmed.confirmation.shipping_cents, 100);

  // A second confirmation is rejected.
  await assert.rejects(() => procurement.confirmPurchase(BUYER1, itemId, {
    actual_platform: "Taobao", actual_order_no: "TB123", quantity: 1, cost: 9.9
  }), (e) => e.statusCode === 409);
});

test("confirmed quantity cannot exceed the ordered quantity", async () => {
  const { procurement, itemId } = await setup();
  await procurement.claimTask(BUYER1, itemId);
  await assert.rejects(() => procurement.confirmPurchase(BUYER1, itemId, {
    actual_platform: "Taobao", actual_order_no: "TB123", quantity: 4, cost: 9.9 // ordered 3
  }), (e) => e.statusCode === 400);
});

test("only the claiming buyer can confirm the purchase", async () => {
  const { procurement, itemId } = await setup();
  await procurement.claimTask(BUYER1, itemId);
  await assert.rejects(() => procurement.confirmPurchase(BUYER2, itemId, {
    actual_platform: "Taobao", actual_order_no: "TB123", quantity: 1, cost: 9.9
  }), (e) => e.statusCode === 403);
});

test("task list is scope-filtered: lead sees all, buyer sees own claims, search needs item_no", async () => {
  const { procurement, itemId } = await setup();
  await procurement.claimTask(BUYER1, itemId);

  const orgView = await procurement.listTasks({ scope: "ORG", adminUserId: BUYER2.id });
  assert.equal(orgView.tasks.length, 1); // lead sees it regardless of claimer

  const selfOther = await procurement.listTasks({ scope: "SELF", adminUserId: BUYER2.id });
  assert.equal(selfOther.tasks.length, 0); // buyer 2 did not claim it

  const selfOwner = await procurement.listTasks({ scope: "SELF", adminUserId: BUYER1.id });
  assert.equal(selfOwner.tasks.length, 1);

  const search = await procurement.listTasks(
    { scope: "SEARCH", adminUserId: BUYER2.id, exactSearch: { item_no: selfOwner.tasks[0].item_no } }
  );
  assert.equal(search.tasks.length, 1);
});
