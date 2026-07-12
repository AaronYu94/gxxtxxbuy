import assert from "node:assert/strict";
import test from "node:test";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createOrderService } from "../src/orders/order-service.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";

const ADMIN = { id: "33333333-3333-3333-3333-333333333333" };
const USER = { id: "44444444-4444-4444-4444-444444444444" };

function procurementService() {
  return createProcurementService({ repository: new MemoryProcurementRepository() });
}

async function orderWithAssignment({ withAccount = true, platform = "Taobao" } = {}) {
  const procurementRepo = new MemoryProcurementRepository();
  const procurement = createProcurementService({ repository: procurementRepo });
  const catalog = new MemoryCatalogRepository();
  const order = new MemoryOrderRepository();
  const orders = createOrderService({
    repository: order,
    catalogRepository: catalog,
    accountPicker: (p) => procurement.pickAccountForPlatform(p)
  });
  if (withAccount) {
    await procurement.createAccount(ADMIN, { platform, label: "Main", role: "default" });
  }
  const snapshot = await catalog.createSnapshot({
    userId: USER.id, platform, sourceUrl: "https://item.taobao.com/item.htm?id=1",
    title: "Sneaker", priceCents: 1000, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order: created } = await orders.createOrder(USER, { submit_key: "k", items: [{ snapshot_id: snapshot.id, quantity: 1 }] });
  return { orders, order: order, procurement, parentId: created.id };
}

test("account create/list/update is version-guarded", async () => {
  const svc = procurementService();
  const created = (await svc.createAccount(ADMIN, { platform: "Taobao", label: "Main", role: "default" })).account;
  assert.equal(created.version, 1);
  assert.equal(created.enabled, true);

  const listed = (await svc.listAccounts({ platform: "Taobao" })).accounts;
  assert.equal(listed.length, 1);

  const updated = (await svc.updateAccount(ADMIN, created.id, { version: 1, enabled: false })).account;
  assert.equal(updated.enabled, false);
  assert.equal(updated.version, 2);

  // Stale version is rejected.
  await assert.rejects(
    () => svc.updateAccount(ADMIN, created.id, { version: 1, label: "Stale" }),
    (error) => error.statusCode === 409
  );
});

test("account picking prefers an enabled default over backup and skips disabled", async () => {
  const svc = procurementService();
  const backup = (await svc.createAccount(ADMIN, { platform: "1688", label: "Backup", role: "backup" })).account;
  const def = (await svc.createAccount(ADMIN, { platform: "1688", label: "Default", role: "default" })).account;

  const picked = await svc.pickAccountForPlatform("1688");
  assert.equal(picked.id, def.id); // default wins

  await svc.updateAccount(ADMIN, def.id, { version: 1, enabled: false });
  const fallback = await svc.pickAccountForPlatform("1688");
  assert.equal(fallback.id, backup.id); // falls back to enabled backup

  assert.equal(await svc.pickAccountForPlatform("Weidian"), null); // none configured
});

test("post-payment marks paid, moves items to agent_ordering, and assigns an account", async () => {
  const { orders, parentId } = await orderWithAssignment({ withAccount: true });
  const result = await orders.markPaidAndAssign({ type: "system" }, parentId, { eventId: "evt-1" });

  assert.equal(result.order.payment_status, "paid");
  assert.equal(result.order.items[0].fulfillment_status, "agent_ordering");
  assert.ok(result.order.items[0].purchase_account_id);
  assert.equal(result.assignments[0].assigned, true);
});

test("a platform with no account routes the paid item to the manual_review exception queue", async () => {
  const { orders, parentId } = await orderWithAssignment({ withAccount: false });
  const result = await orders.markPaidAndAssign({ type: "system" }, parentId, { eventId: "evt-2" });

  assert.equal(result.order.items[0].fulfillment_status, "agent_ordering");
  assert.equal(result.order.items[0].exception_status, "manual_review");
  assert.equal(result.assignments[0].assigned, false);
  assert.equal(result.assignments[0].reason, "no_purchase_account");
});

test("replaying the same payment event does not double-assign", async () => {
  const { orders, parentId } = await orderWithAssignment({ withAccount: true });
  const first = await orders.markPaidAndAssign({ type: "system" }, parentId, { eventId: "evt-3" });
  const accountId = first.order.items[0].purchase_account_id;

  const second = await orders.markPaidAndAssign({ type: "system" }, parentId, { eventId: "evt-3" });
  assert.equal(second.order.items[0].purchase_account_id, accountId); // unchanged
  assert.equal(second.assignments[0].replay, true);
});
