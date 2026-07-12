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
const QC2 = { id: "bbbbbbbb-0000-0000-0000-000000000002" };

let seed = 800;
async function arrivedItem() {
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
  await wms.scanArrival(ADMIN, { tracking_no: tn });
  return { wms, orders, orderRepo, itemId };
}

test("arrival auto-creates a pending standard QC task", async () => {
  const { wms } = await arrivedItem();
  const { qc_tasks } = await wms.listQcTasks({ status: "pending" });
  assert.equal(qc_tasks.length, 1);
  assert.equal(qc_tasks[0].type, "standard");
});

test("claim is exclusive and moves the item to qc_in_progress", async () => {
  const { wms, orderRepo, itemId } = await arrivedItem();
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  const claimed = await wms.claimQc(QC1, taskId);
  assert.equal(claimed.qc_task.status, "claimed");
  assert.equal((await orderRepo.findItemById(itemId)).fulfillmentStatus, "qc_in_progress");

  // A second operator cannot claim it.
  await assert.rejects(() => wms.claimQc(QC2, taskId), (e) => e.statusCode === 409);
});

test("only the assignee can start and upload; four slots make it complete-ready", async () => {
  const { wms } = await arrivedItem();
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(QC1, taskId);

  await assert.rejects(() => wms.startQc(QC2, taskId), (e) => e.statusCode === 409); // not the claimer
  await wms.startQc(QC1, taskId);

  await assert.rejects(() => wms.uploadQcPhoto(QC2, taskId, { slot: "front", storage_key: "k" }), (e) => e.statusCode === 403);
  await assert.rejects(() => wms.uploadQcPhoto(QC1, taskId, { slot: "top", storage_key: "k" }), (e) => e.statusCode === 400); // invalid slot

  await wms.uploadQcPhoto(QC1, taskId, { slot: "front", storage_key: "f.jpg" });
  await wms.uploadQcPhoto(QC1, taskId, { slot: "back", storage_key: "b.jpg" });
  await wms.uploadQcPhoto(QC1, taskId, { slot: "side", storage_key: "s.jpg" });
  let last = await wms.uploadQcPhoto(QC1, taskId, { slot: "label", storage_key: "l.jpg" });
  assert.equal(last.complete_ready, true);

  // Re-shoot keeps history (a new version), still one current slot.
  last = await wms.uploadQcPhoto(QC1, taskId, { slot: "front", storage_key: "f2.jpg" });
  const detail = await wms.getQcTask(taskId);
  assert.equal(detail.present_slots.sort().join(","), "back,front,label,side");
  assert.equal(detail.photos.filter((p) => p.slot === "front").length, 2); // history preserved
});

test("release returns the task to the pending pool", async () => {
  const { wms } = await arrivedItem();
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(QC1, taskId);
  const released = await wms.releaseQc(ADMIN, taskId);
  assert.equal(released.qc_task.status, "pending");
  assert.equal(released.qc_task.assignee_admin_id, null);
});
