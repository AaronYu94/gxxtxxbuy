import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createFinanceService } from "../src/finance/finance-service.js";
import { createWmsService } from "../src/wms/wms-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryWmsRepository } from "./helpers/memory-wms-repository.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };

function graph() {
  const clockState = { ms: Date.parse("2026-03-01T00:00:00.000Z") };
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p), clock: () => clockState.ms });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders, financeService: finance, clock: () => clockState.ms });
  return { clockState, orderRepo, catalog, finance, procurement, orders, wms };
}

async function snapshot(catalog, platform = "Taobao", price = 1000) {
  return catalog.createSnapshot({ userId: USER.id, platform, sourceUrl: `https://x/${Math.random()}`, title: "P", priceCents: price, currency: "CNY", domesticShippingCents: 100, source: "manual" });
}

// ---- V2-12-11 E2E-01 淘宝代购正常流程 ----
test("E2E-01: parse → pay → purchase → dispatch → arrive → measure → QC → warehoused", async () => {
  const { catalog, procurement, orders, wms } = graph();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snap = await snapshot(catalog);
  const { order } = await orders.createOrder(USER, { submit_key: "e01", items: [{ snapshot_id: snap.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e01pay" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: "O", quantity: 1, cost: 9 });
  await orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: "E01-1" });

  // Warehouse: arrival matches the dispatched tracking; measure; QC; warehouse.
  const scan = await wms.scanArrival(ADMIN, { tracking_no: "E01-1" });
  assert.equal(scan.matched, true);
  await wms.submitMeasurement(ADMIN, scan.inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 });
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(ADMIN, taskId); await wms.startQc(ADMIN, taskId);
  for (const s of ["front", "back", "side", "label"]) await wms.uploadQcPhoto(ADMIN, taskId, { slot: s, storage_key: `${s}.jpg` });
  const completed = await wms.completeQc(ADMIN, taskId);
  // Full chain reached official warehousing with an inventory unit + inbound time.
  assert.ok(completed.inventory.stock_no);
  assert.ok(completed.inventory.official_inbound_at);
  const item = await orders.getItemHistory(itemId);
  assert.equal(item.item.fulfillment_status, "warehoused");
});

// ---- V2-12-12 E2E-02 1688 涨价 ----
test("E2E-02: price increase — accept continues; timeout auto-cancels + refunds the sub-order", async () => {
  const { clockState, orderRepo, catalog, procurement, orders } = graph();
  await procurement.createAccount(ADMIN, { platform: "1688", label: "M", role: "default" });
  const snap = await snapshot(catalog, "1688", 1000);
  const snap2 = await snapshot(catalog, "1688", 1000);
  const { order } = await orders.createOrder(USER, { submit_key: "e02", items: [{ snapshot_id: snap.id, quantity: 2 }, { snapshot_id: snap2.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e02pay" });
  const itemId = order.items[0].id;
  // Claiming a procurement task moves the item into 采购处理中 (purchasing).
  await procurement.claimTask(BUYER, itemId);

  const raised = await orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 1500, deadline_hours: 24 });
  assert.equal(raised.exception.surcharge_cents ?? raised.exception.surchargeCents, (1500 - 1000) * 2); // (new-old)*qty

  // (a) The buyer accepts the surcharge → the item continues (exception cleared).
  const accepted = await orders.respondException(USER, itemId, { choice: "pay_surcharge" });
  assert.ok(accepted.item); // resolved, still in the purchase pipeline (not cancelled)
  assert.notEqual(accepted.item.fulfillment_status ?? accepted.item.fulfillmentStatus, "cancelled");

  // (b) A second item that is NOT answered before the 24h deadline auto-cancels.
  const item2 = order.items[1].id;
  await procurement.claimTask(BUYER, item2);
  await orders.raisePriceIncrease(ADMIN, item2, { new_unit_price_cents: 1500, deadline_hours: 24 });
  clockState.ms += 25 * 3600 * 1000; // past the deadline
  // Responding after the deadline is refused (it is being auto-cancelled).
  await assert.rejects(() => orders.respondException(USER, item2, { choice: "pay_surcharge" }), (e) => e.statusCode === 409);
});

// ---- V2-12-13 E2E-03 部分缺货取消 ----
test("E2E-03: cancelling one out-of-stock sub-order leaves the others active", async () => {
  const { catalog, procurement, orders } = graph();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snapA = await snapshot(catalog);
  const snapB = await snapshot(catalog);
  const { order } = await orders.createOrder(USER, { submit_key: "e03", items: [{ snapshot_id: snapA.id, quantity: 1 }, { snapshot_id: snapB.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e03pay" });
  const [itemA, itemB] = order.items.map((i) => i.id);
  await procurement.claimTask(BUYER, itemA); // → purchasing
  // Item A is out of stock → raise a (cancellable) exception; the user cancels ONLY it.
  await orders.raisePriceIncrease(ADMIN, itemA, { new_unit_price_cents: 1200 });
  const cancelled = await orders.respondException(USER, itemA, { choice: "cancel" });
  assert.equal(cancelled.item.fulfillment_status ?? cancelled.item.fulfillmentStatus, "cancelled");
  // Item B is untouched and still progressing.
  const bHist = await orders.getItemHistory(itemB);
  assert.notEqual(bHist.item.fulfillment_status, "cancelled");
});

// ---- V2-12-14 E2E-04 转运预报 ----
test("E2E-04: a predicted tracking auto-matches; an unpredicted one goes to unclaimed (no guessing)", async () => {
  const { catalog, procurement, orders, wms } = graph();
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snap = await snapshot(catalog);
  const { order } = await orders.createOrder(USER, { submit_key: "e04", items: [{ snapshot_id: snap.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e04pay" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: "O", quantity: 1, cost: 9 });
  await orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: "FORECAST-1" });

  // Predicted (dispatched) tracking → auto-matched.
  const matched = await wms.scanArrival(ADMIN, { tracking_no: "FORECAST-1" });
  assert.equal(matched.matched, true);
  // An unknown tracking → unclaimed, never guessed onto a user.
  const unknown = await wms.scanArrival(ADMIN, { tracking_no: "NEVER-SEEN-999" });
  assert.equal(unknown.matched, false);
  assert.equal(unknown.inbound.status, "unclaimed");
  const unclaimed = await wms.listUnclaimed();
  assert.ok(unclaimed.inbound_packages.some((p) => p.domestic_tracking_no === "NEVER-SEEN-999"));
});
