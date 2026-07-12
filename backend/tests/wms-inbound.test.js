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

function stack() {
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders });
  return { orders, procurement, catalog, wms, orderRepo };
}

let seed = 700;
async function dispatchedItem(s, trackingNo) {
  await s.procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snap = await s.catalog.createSnapshot({
    userId: USER.id, platform: "Taobao", sourceUrl: `https://x/${seed++}`, title: "P",
    priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order } = await s.orders.createOrder(USER, { submit_key: `k${seed}`, items: [{ snapshot_id: snap.id, quantity: 1 }] });
  await s.orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: `e${seed}` });
  const itemId = order.items[0].id;
  await s.procurement.claimTask(BUYER, itemId);
  await s.procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: `O${seed}`, quantity: 1, cost: 9 });
  await s.orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: trackingNo });
  return itemId;
}

test("scanning a known courier number matches the order and moves the item to arrived", async () => {
  const s = stack();
  const itemId = await dispatchedItem(s, "SF-MATCH-1");
  const result = await s.wms.scanArrival(ADMIN, { tracking_no: "SF-MATCH-1", carrier: "SF" });
  assert.equal(result.matched, true);
  assert.equal(result.inbound.status, "matched");
  const item = await s.orderRepo.findItemById(itemId);
  assert.equal(item.fulfillmentStatus, "arrived");
});

test("a duplicate scan returns the first record and does not create a second", async () => {
  const s = stack();
  await dispatchedItem(s, "SF-DUP-1");
  const first = await s.wms.scanArrival(ADMIN, { tracking_no: "SF-DUP-1" });
  const again = await s.wms.scanArrival(BUYER, { tracking_no: "SF-DUP-1" });
  assert.equal(again.existing, true);
  assert.equal(again.inbound.id, first.inbound.id);
  assert.ok(again.inbound.first_scanned_at);
});

test("an unknown courier number lands in the unclaimed queue (no user guessing)", async () => {
  const s = stack();
  const result = await s.wms.scanArrival(ADMIN, { tracking_no: "UNKNOWN-9" });
  assert.equal(result.matched, false);
  assert.equal(result.inbound.status, "unclaimed");
  const { inbound_packages } = await s.wms.listUnclaimed();
  assert.equal(inbound_packages.length, 1);
});

test("manual link requires evidence and then binds + arrives the order", async () => {
  const s = stack();
  const itemId = await dispatchedItem(s, "SF-LINK-1");
  // Scan a different (mistyped) number → unclaimed.
  const unclaimed = (await s.wms.scanArrival(ADMIN, { tracking_no: "SF-LNK-typo" })).inbound;

  await assert.rejects(() => s.wms.manualLink(ADMIN, unclaimed.id, { item_order_id: itemId, evidence: [] }), (e) => e.statusCode === 400);
  const linked = await s.wms.manualLink(ADMIN, unclaimed.id, { item_order_id: itemId, evidence: ["photo/label.jpg"] });
  assert.equal(linked.inbound.status, "matched");
  assert.equal((await s.orderRepo.findItemById(itemId)).fulfillmentStatus, "arrived");
});

test("measurement requires a photo and is version-guarded", async () => {
  const s = stack();
  await dispatchedItem(s, "SF-MEAS-1");
  const inbound = (await s.wms.scanArrival(ADMIN, { tracking_no: "SF-MEAS-1" })).inbound;

  // No photo → not marked measured.
  await assert.rejects(() => s.wms.submitMeasurement(ADMIN, inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: [], version: 0 }), (e) => e.statusCode === 400);
  const measured = await s.wms.submitMeasurement(ADMIN, inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 });
  assert.equal(measured.inbound.status, "measured");
  // Stale version → conflict.
  await assert.rejects(() => s.wms.submitMeasurement(ADMIN, inbound.id, { weight_grams: 600, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 }), (e) => e.statusCode === 409);
});
