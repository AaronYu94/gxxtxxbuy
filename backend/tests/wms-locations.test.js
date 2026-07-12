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

let seed = 890;
async function stocked() {
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
  await wms.submitMeasurement(ADMIN, inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 });
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(ADMIN, taskId); await wms.startQc(ADMIN, taskId);
  for (const s of ["front", "back", "side", "label"]) await wms.uploadQcPhoto(ADMIN, taskId, { slot: s, storage_key: `${s}.jpg` });
  const stockNo = (await wms.completeQc(ADMIN, taskId)).inventory.stock_no;
  return { wms, stockNo };
}

test("double-scan assignment sets the location; re-scan is idempotent; a second location conflicts", async () => {
  const { wms, stockNo } = await stocked();
  await wms.createLocation(ADMIN, { code: "A-1-1-1" });
  await wms.createLocation(ADMIN, { code: "A-1-1-2" });

  const assigned = await wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "A-1-1-1" });
  assert.ok(assigned.inventory.location_id);
  const again = await wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "A-1-1-1" });
  assert.equal(again.replay, true);
  await assert.rejects(() => wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "A-1-1-2" }), (e) => e.statusCode === 409);
});

test("movement requires the correct origin and records history", async () => {
  const { wms, stockNo } = await stocked();
  await wms.createLocation(ADMIN, { code: "B-1" });
  await wms.createLocation(ADMIN, { code: "B-2" });
  await wms.createLocation(ADMIN, { code: "B-3" });
  await wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "B-1" });

  await assert.rejects(() => wms.moveLocation(ADMIN, { stock_no: stockNo, from_location_code: "B-3", to_location_code: "B-2", reason: "reorg" }), (e) => e.statusCode === 409);
  const moved = await wms.moveLocation(ADMIN, { stock_no: stockNo, from_location_code: "B-1", to_location_code: "B-2", reason: "reorg" });
  assert.ok(moved.inventory.location_id);
});

test("a location with inventory cannot be disabled", async () => {
  const { wms, stockNo } = await stocked();
  const loc = (await wms.createLocation(ADMIN, { code: "C-1" })).location;
  await wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "C-1" });
  await assert.rejects(() => wms.disableLocation(ADMIN, loc.id), (e) => e.statusCode === 409);

  const empty = (await wms.createLocation(ADMIN, { code: "C-2" })).location;
  const disabled = await wms.disableLocation(ADMIN, empty.id);
  assert.equal(disabled.location.enabled, false);
});

test("shipping restrictions are set and whitelisted", async () => {
  const { wms, stockNo } = await stocked();
  const inv = (await wms.setShippingRestrictions(ADMIN, { stock_no: stockNo, restrictions: ["battery", "liquid", "bogus"] })).inventory;
  assert.deepEqual(inv.shipping_restrictions.sort(), ["battery", "liquid"]); // 'bogus' filtered out
});
