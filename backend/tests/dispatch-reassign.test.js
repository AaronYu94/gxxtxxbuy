import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };
const LEAD = { id: "88888888-8888-8888-8888-888888888888" };

function stack() {
  const procurementRepo = new MemoryProcurementRepository();
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: procurementRepo, orderRepository: orderRepo });
  const orders = createOrderService({
    repository: orderRepo, catalogRepository: catalog,
    accountPicker: (p) => procurement.pickAccountForPlatform(p)
  });
  return { procurement, orders, catalog };
}

let seed = 500;
// Drive one item to seller_dispatch_pending for a given user.
async function dispatchPendingItem({ procurement, orders, catalog }, userId, { withAccount = true } = {}) {
  if (withAccount) await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snapshot = await catalog.createSnapshot({
    userId, platform: "Taobao", sourceUrl: `https://item.taobao.com/item.htm?id=${seed++}`,
    title: "S", priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order } = await orders.createOrder({ id: userId }, { submit_key: `k${seed}`, items: [{ snapshot_id: snapshot.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: `e${seed}` });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: `O${seed}`, quantity: 1, cost: 9 });
  return itemId;
}

test("registering dispatch records carrier + tracking and advances to seller_dispatched", async () => {
  const s = stack();
  const itemId = await dispatchPendingItem(s, "44444444-4444-4444-4444-444444444444");
  const result = await s.orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: "SF123" });
  assert.equal(result.item.fulfillment_status, "seller_dispatched");
  assert.equal(result.item.carrier, "SF");
  assert.equal(result.item.domestic_tracking_no, "SF123");
});

test("a tracking number cannot cross-bind a different user's order", async () => {
  const s = stack();
  const itemA = await dispatchPendingItem(s, "aaaaaaaa-0000-0000-0000-000000000001");
  const itemB = await dispatchPendingItem(s, "bbbbbbbb-0000-0000-0000-000000000002", { withAccount: false });
  await s.orders.registerDispatch(ADMIN, itemA, { carrier: "SF", tracking_no: "DUP1" });
  await assert.rejects(
    () => s.orders.registerDispatch(ADMIN, itemB, { carrier: "SF", tracking_no: "DUP1" }),
    (e) => e.statusCode === 409
  );
});

test("dispatch correction updates the tracking on an already-dispatched item", async () => {
  const s = stack();
  const itemId = await dispatchPendingItem(s, "44444444-4444-4444-4444-444444444444");
  await s.orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: "OLD" });
  const corrected = await s.orders.correctDispatch(ADMIN, itemId, { tracking_no: "NEW" });
  assert.equal(corrected.item.domestic_tracking_no, "NEW");
  assert.equal(corrected.item.carrier, "SF"); // unchanged
});

test("reassign changes the purchase account and buyer on a non-terminal item", async () => {
  const s = stack();
  const itemId = await dispatchPendingItem(s, "44444444-4444-4444-4444-444444444444");
  const acc = (await s.procurement.createAccount(ADMIN, { platform: "Taobao", label: "Alt", role: "backup" })).account;
  const result = await s.orders.reassignItem(LEAD, itemId, { account_id: acc.id, buyer_admin_id: LEAD.id });
  assert.equal(result.item.purchase_account_id, acc.id);
  assert.equal(result.item.claimed_by_admin_id, LEAD.id);
});

test("controlled correction: terminal target needs super_admin; non-terminal allowed for lead", async () => {
  const s = stack();
  const itemId = await dispatchPendingItem(s, "44444444-4444-4444-4444-444444444444");

  // Lead (no super_admin) forcing a terminal status is rejected.
  await assert.rejects(
    () => s.orders.controlledCorrection(LEAD, ["procurement_lead"], itemId, { to: "cancelled", reason: "x" }),
    (e) => e.statusCode === 403
  );

  // Super admin can force the terminal status.
  const forced = await s.orders.controlledCorrection(ADMIN, ["super_admin"], itemId, { to: "cancelled", reason: "fraud" });
  assert.equal(forced.item.fulfillment_status, "cancelled");
});
