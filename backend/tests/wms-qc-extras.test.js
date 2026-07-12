import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createFinanceService } from "../src/finance/finance-service.js";
import { createWmsService, validateDetailedResults } from "../src/wms/wms-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryWmsRepository } from "./helpers/memory-wms-repository.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };
const QC1 = { id: "aaaaaaaa-0000-0000-0000-000000000001" };

let seed = 850;
async function arrivedStack() {
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const wms = createWmsService({ repository: new MemoryWmsRepository(), orderRepository: orderRepo, orderService: orders, financeService: finance });
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
  return { wms, orders, finance, itemId };
}

test("extra photos cost 1 CNY each, debit the wallet, and are idempotent", async () => {
  const { wms, finance, itemId } = await arrivedStack();
  await finance.credit(USER.id, 100000, {});
  const first = await wms.buyExtraPhotos(USER, itemId, { quantity: 3, idempotency_key: "ep-1" });
  assert.equal(first.purchase.amount_cny_minor, 300); // 3 * 1 CNY
  assert.equal((await finance.getBalance(USER.id)).wallet.available_cny_minor, 99700);

  const dup = await wms.buyExtraPhotos(USER, itemId, { quantity: 3, idempotency_key: "ep-1" });
  assert.equal(dup.existing, true);
  assert.equal((await finance.getBalance(USER.id)).wallet.available_cny_minor, 99700); // not charged twice
});

test("detailed inspection costs 5 CNY per item", async () => {
  const { wms, finance, itemId } = await arrivedStack();
  await finance.credit(USER.id, 100000, {});
  const bought = await wms.buyDetailedCheck(USER, itemId, { items: [{ name: "zipper" }, { name: "sole", electronics: false }], idempotency_key: "dc-1" });
  assert.equal(bought.purchase.amount_cny_minor, 1000); // 2 * 5 CNY
  assert.equal(bought.purchase.quantity, 2);
});

test("detailed results cannot mark an electronics item as functionally tested", () => {
  assert.equal(validateDetailedResults([{ name: "cable", electronics: true, result: "functional_ok" }]).ok, false);
  assert.equal(validateDetailedResults([{ name: "shirt", electronics: false, result: "functional_ok" }]).ok, true);
});

test("a QC exception blocks and can be resolved back to in_progress", async () => {
  const { wms, itemId } = await arrivedStack();
  const taskId = (await wms.listQcTasks({ status: "pending" })).qc_tasks[0].id;
  await wms.claimQc(QC1, taskId);
  await wms.startQc(QC1, taskId);

  const raised = await wms.raiseQcException(QC1, taskId, { type: "damaged", note: "dent on box", photo_keys: ["ex.jpg"] });
  assert.equal(raised.qc_task.status, "exception");
  assert.equal(raised.exception.status, "open");

  const resolved = await wms.resolveQcException(ADMIN, taskId);
  assert.equal(resolved.qc_task.status, "in_progress");
});
