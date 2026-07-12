import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createWmsService } from "../src/wms/wms-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryWmsRepository } from "./helpers/memory-wms-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };
const QC1 = { id: "aaaaaaaa-0000-0000-0000-000000000001" };

let seed = 870;
async function ready({ measure = true, photos = 4, exception = false } = {}) {
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders });
  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snap = await catalog.createSnapshot({ userId: USER.id, platform: "Taobao", sourceUrl: `https://x/${seed++}`, title: "P", priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual" });
  const { order } = await orders.createOrder(USER, { submit_key: `k${seed}`, items: [{ snapshot_id: snap.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: `e${seed}` });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: `O${seed}`, quantity: 1, cost: 9 });
  const tn = `SF-${seed}`;
  await orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: tn });
  const inbound = (await wms.scanArrival(ADMIN, { tracking_no: tn })).inbound;
  if (measure) await wms.submitMeasurement(ADMIN, inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 });
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(QC1, taskId);
  await wms.startQc(QC1, taskId);
  const slots = ["front", "back", "side", "label"].slice(0, photos);
  for (const s of slots) await wms.uploadQcPhoto(QC1, taskId, { slot: s, storage_key: `${s}.jpg` });
  if (exception) await wms.raiseQcException(QC1, taskId, { type: "damaged" });
  return { wms, orders, orderRepo, taskId, itemId };
}

test("completing QC creates the inventory unit, sets the 5-day window, and warehouses the item", async () => {
  const { wms, orderRepo, taskId, itemId } = await ready({});
  const done = await wms.completeQc(ADMIN, taskId);
  assert.equal(done.qc_task.status, "completed");
  assert.equal(done.inventory.status, "in_stock");
  const inbound = Date.parse(done.inventory.official_inbound_at);
  const deadline = Date.parse(done.inventory.return_deadline_at);
  assert.equal(deadline - inbound, 5 * 24 * 3600 * 1000); // 5-day return window
  assert.equal((await orderRepo.findItemById(itemId)).fulfillmentStatus, "warehoused");
});

test("QC cannot complete without all four photos", async () => {
  const { wms, taskId } = await ready({ photos: 3 });
  await assert.rejects(() => wms.completeQc(ADMIN, taskId), (e) => e.statusCode === 409);
});

test("QC cannot complete with an open exception", async () => {
  const { wms, taskId } = await ready({ exception: true });
  await assert.rejects(() => wms.completeQc(ADMIN, taskId), (e) => e.statusCode === 409);
});

test("re-completing is idempotent — one inventory unit, the time is not re-stamped", async () => {
  const { wms, taskId } = await ready({});
  const first = await wms.completeQc(ADMIN, taskId);
  const again = await wms.completeQc(ADMIN, taskId);
  assert.equal(again.replay, true);
  assert.equal(again.inventory.id, first.inventory.id);
  assert.equal(again.inventory.official_inbound_at, first.inventory.official_inbound_at);
});
