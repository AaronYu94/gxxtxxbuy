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

const DAY = 86400000;
const USER = { id: "44444444-4444-4444-4444-444444444444" };
const OTHER = { id: "77777777-7777-7777-7777-777777777777" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };

test("E2E warehouse anti-error flow: duplicate arrival, wrong location, missing photos, cross-user, deadlines, destroyed lock", async () => {
  const clockState = { ms: Date.parse("2026-03-01T00:00:00.000Z") };
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders, financeService: finance, clock: () => clockState.ms });

  await procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const snap = await catalog.createSnapshot({ userId: USER.id, platform: "Taobao", sourceUrl: "https://x/e2e", title: "P", priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual" });
  const { order } = await orders.createOrder(USER, { submit_key: "e2e", items: [{ snapshot_id: snap.id, quantity: 1 }] });
  await orders.markPaidAndAssign({ type: "system" }, order.id, { eventId: "e" });
  const itemId = order.items[0].id;
  await procurement.claimTask(BUYER, itemId);
  await procurement.confirmPurchase(BUYER, itemId, { actual_platform: "Taobao", actual_order_no: "O", quantity: 1, cost: 9 });
  await orders.registerDispatch(ADMIN, itemId, { carrier: "SF", tracking_no: "E2E-1" });

  // (1) Arrival + duplicate scan.
  const scan = await wms.scanArrival(ADMIN, { tracking_no: "E2E-1" });
  assert.equal(scan.matched, true);
  const dup = await wms.scanArrival(ADMIN, { tracking_no: "E2E-1" });
  assert.equal(dup.existing, true);
  assert.equal(dup.inbound.id, scan.inbound.id);

  await wms.submitMeasurement(ADMIN, scan.inbound.id, { weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, photo_keys: ["p.jpg"], version: 0 });
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(ADMIN, taskId); await wms.startQc(ADMIN, taskId);

  // (2) Missing-photo completion is blocked.
  await wms.uploadQcPhoto(ADMIN, taskId, { slot: "front", storage_key: "f.jpg" });
  await assert.rejects(() => wms.completeQc(ADMIN, taskId), (e) => e.statusCode === 409);
  for (const s of ["back", "side", "label"]) await wms.uploadQcPhoto(ADMIN, taskId, { slot: s, storage_key: `${s}.jpg` });
  const completedInv = (await wms.completeQc(ADMIN, taskId)).inventory;
  const stockNo = completedInv.stock_no;
  const inboundMs = Date.parse(completedInv.official_inbound_at);
  clockState.ms = inboundMs; // align to the actual inbound time

  // (3) Cross-user access is denied.
  await assert.rejects(() => wms.getStorageStatus(OTHER, stockNo), (e) => e.statusCode === 404);

  // (4) Double-scan location: wrong origin move is rejected.
  await wms.createLocation(ADMIN, { code: "E-1" });
  await wms.createLocation(ADMIN, { code: "E-2" });
  await wms.createLocation(ADMIN, { code: "E-3" });
  await wms.assignLocation(ADMIN, { stock_no: stockNo, location_code: "E-1" });
  await assert.rejects(() => wms.moveLocation(ADMIN, { stock_no: stockNo, from_location_code: "E-3", to_location_code: "E-2", reason: "x" }), (e) => e.statusCode === 409);
  await wms.moveLocation(ADMIN, { stock_no: stockNo, from_location_code: "E-1", to_location_code: "E-2", reason: "reorg" });

  // (5) Deadline boundary: cannot destroy before 150 days.
  await assert.rejects(() => wms.markForDestroy(ADMIN, stockNo), (e) => e.statusCode === 409);
  clockState.ms = inboundMs + 151 * DAY;
  await wms.markForDestroy(ADMIN, stockNo);

  // (6) Destruction is irreversible.
  const destroyed = await wms.executeDestroy(ADMIN, stockNo, { quantity: 1, photo_keys: ["d.jpg"] });
  assert.equal(destroyed.inventory.status, "destroyed");
  const again = await wms.executeDestroy(ADMIN, stockNo, { quantity: 1, photo_keys: ["d.jpg"] });
  assert.equal(again.replay, true);
  assert.equal((await orders.getItemHistory(itemId)).item.fulfillment_status, "destroyed");
});
