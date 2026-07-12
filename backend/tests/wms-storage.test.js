import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createFinanceService } from "../src/finance/finance-service.js";
import { createWmsService } from "../src/wms/wms-service.js";
import { computeStorage, dueMilestone } from "../src/wms/storage-rules.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryWmsRepository } from "./helpers/memory-wms-repository.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const DAY = 86400000;
const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };

let seed = 910;
async function stocked() {
  const clockState = { ms: Date.parse("2026-01-01T00:00:00.000Z") };
  const clock = () => clockState.ms;
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders, financeService: finance, clock });
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
  const inv = (await wms.completeQc(ADMIN, taskId)).inventory;
  const inboundMs = Date.parse(inv.official_inbound_at);
  clockState.ms = inboundMs; // align the clock to the actual inbound time
  return { wms, finance, orders, clockState, stockNo: inv.stock_no, itemId, inboundMs };
}

test("storage rules: 90-day free window, 150-day destroy eligibility, reminder milestones", () => {
  const inbound = "2026-01-01T00:00:00.000Z";
  const base = Date.parse(inbound);
  const fresh = computeStorage(inbound, 0, base);
  assert.equal(fresh.daysLeft, 90);
  assert.equal(fresh.destroyEligible, false);
  const extended = computeStorage(inbound, 2, base);
  assert.equal(extended.daysLeft, 150); // 90 + 2*30
  assert.equal(computeStorage(inbound, 0, base + 151 * DAY).destroyEligible, true);
  assert.equal(dueMilestone(20), null);
  assert.equal(dueMilestone(10), 15);
  assert.equal(dueMilestone(2), 3);
  assert.equal(dueMilestone(-1), 0);
});

test("paid extension charges 10 CNY/month and caps at two months", async () => {
  const { wms, finance, stockNo } = await stocked();
  await finance.credit(USER.id, 100000, {});
  const one = await wms.buyStorageExtension(USER, stockNo, { months: 1, idempotency_key: "sx-1" });
  assert.equal(one.storage.daysLeft, 120); // 90 + 30
  assert.equal((await finance.getBalance(USER.id)).wallet.available_cny_minor, 99000); // 10 CNY

  const two = await wms.buyStorageExtension(USER, stockNo, { months: 1, idempotency_key: "sx-2" });
  assert.equal(two.storage.daysLeft, 150);
  // A third month exceeds the cap.
  await assert.rejects(() => wms.buyStorageExtension(USER, stockNo, { months: 1, idempotency_key: "sx-3" }), (e) => e.statusCode === 409);
});

test("the sweep sends each reminder once and marks overdue items for destruction", async () => {
  const { wms, clockState, inboundMs } = await stocked();
  clockState.ms = inboundMs + 85 * DAY; // 5 days left → milestone 7
  const first = await wms.runStorageSweep({});
  assert.equal(first.reminded, 1);
  const repeat = await wms.runStorageSweep({});
  assert.equal(repeat.reminded, 0); // same milestone not re-sent

  clockState.ms = inboundMs + 151 * DAY;
  const overdue = await wms.runStorageSweep({});
  assert.equal(overdue.marked_for_destroy, 1);
});

test("destruction is blocked before 150 days, requires photos, and is irreversible", async () => {
  const { wms, clockState, stockNo, orders, itemId, inboundMs } = await stocked();
  await assert.rejects(() => wms.markForDestroy(ADMIN, stockNo), (e) => e.statusCode === 409); // too early

  clockState.ms = inboundMs + 151 * DAY;
  await wms.markForDestroy(ADMIN, stockNo);
  await assert.rejects(() => wms.executeDestroy(ADMIN, stockNo, { quantity: 1, photo_keys: [] }), (e) => e.statusCode === 400); // no photos
  const done = await wms.executeDestroy(ADMIN, stockNo, { quantity: 1, photo_keys: ["d.jpg"] });
  assert.equal(done.inventory.status, "destroyed");
  assert.equal((await orders.getItemHistory(itemId)).item.fulfillment_status, "destroyed");

  // Re-executing is an idempotent no-op (never recover / re-destroy).
  const again = await wms.executeDestroy(ADMIN, stockNo, { quantity: 1, photo_keys: ["d.jpg"] });
  assert.equal(again.replay, true);
});
