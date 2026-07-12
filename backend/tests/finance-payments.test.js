import assert from "node:assert/strict";
import test from "node:test";
import { createOrderService } from "../src/orders/order-service.js";
import { createProcurementService } from "../src/procurement/procurement-service.js";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";
import { MemoryProcurementRepository } from "./helpers/memory-procurement-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const BUYER = { id: "66666666-6666-6666-6666-666666666666" };

function stack() {
  const clockState = { ms: Date.parse("2026-07-10T00:00:00.000Z") };
  const clock = () => clockState.ms;
  const orderRepo = new MemoryOrderRepository();
  const catalog = new MemoryCatalogRepository();
  const procurement = createProcurementService({ repository: new MemoryProcurementRepository(), orderRepository: orderRepo });
  const orders = createOrderService({ repository: orderRepo, catalogRepository: catalog, clock, accountPicker: (p) => procurement.pickAccountForPlatform(p) });
  const finance = createFinanceService({ repository: new MemoryFinanceRepository(), orderService: orders, clock });
  return { orders, procurement, catalog, finance, clockState };
}

async function makeOrder(s, { quantity = 1, unitYuan = 50 } = {}) {
  const snap = await s.catalog.createSnapshot({
    userId: USER.id, platform: "Taobao", sourceUrl: `https://x/${Math.random()}`,
    title: "P", priceCents: unitYuan * 100, currency: "CNY", domesticShippingCents: 100, source: "manual"
  });
  const { order } = await s.orders.createOrder(USER, { submit_key: `k${Math.random()}`, items: [{ snapshot_id: snap.id, quantity }] });
  return order;
}

test("payOrder debits the wallet once, marks paid, and refuses overspend without partial state", async () => {
  const s = stack();
  await s.procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const order = await makeOrder(s, { quantity: 1, unitYuan: 50 }); // total 5100

  // Insufficient balance → 409, nothing debited, order still unpaid.
  await s.finance.credit(USER.id, 3000, {});
  await assert.rejects(() => s.finance.payOrder(USER, order.id), (e) => e.statusCode === 409);
  assert.equal((await s.finance.getBalance(USER.id)).wallet.available_cny_minor, 3000);

  // Top up and pay.
  await s.finance.credit(USER.id, 3000, {}); // now 6000
  const paid = await s.finance.payOrder(USER, order.id);
  assert.equal(paid.order.payment_status, "paid");
  assert.equal(paid.order.items[0].fulfillment_status, "agent_ordering"); // assigned
  assert.equal(paid.wallet.available_cny_minor, 900); // 6000 - 5100

  // Paying again is idempotent — no second debit.
  const again = await s.finance.payOrder(USER, order.id);
  assert.equal(again.order.payment_status, "paid");
  assert.equal((await s.finance.getBalance(USER.id)).wallet.available_cny_minor, 900);
});

test("payment preview reports the shortfall for a top-up", async () => {
  const s = stack();
  const order = await makeOrder(s, { quantity: 2, unitYuan: 50 }); // 2*5000 + 100 = 10100
  await s.finance.credit(USER.id, 4000, {});
  const preview = await s.finance.getOrderPaymentPreview(USER, order.id);
  assert.equal(preview.total_cny_minor, 10100);
  assert.equal(preview.available_cny_minor, 4000);
  assert.equal(preview.shortfall_cny_minor, 6100);
});

test("paying a surcharge debits the wallet, clears the exception, and is not double-charged", async () => {
  const s = stack();
  await s.procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const order = await makeOrder(s, { quantity: 2, unitYuan: 50 });
  await s.finance.credit(USER.id, 100000, {});
  await s.finance.payOrder(USER, order.id);
  const itemId = order.items[0].id;
  await s.procurement.claimTask(BUYER, itemId);
  await s.orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 6000 }); // surcharge (6000-5000)*2 = 2000

  const balBefore = (await s.finance.getBalance(USER.id)).wallet.available_cny_minor;
  const paid = await s.finance.paySurcharge(USER, itemId);
  assert.equal(paid.item.exception_status, "none");
  assert.equal((await s.finance.getBalance(USER.id)).wallet.available_cny_minor, balBefore - 2000);

  // No open surcharge remains → a repeat is rejected, never a second debit.
  await assert.rejects(() => s.finance.paySurcharge(USER, itemId), (e) => e.statusCode === 409);
});

test("an expired surcharge cannot be paid", async () => {
  const s = stack();
  await s.procurement.createAccount(ADMIN, { platform: "Taobao", label: "M", role: "default" });
  const order = await makeOrder(s, { quantity: 1, unitYuan: 50 });
  await s.finance.credit(USER.id, 100000, {});
  await s.finance.payOrder(USER, order.id);
  const itemId = order.items[0].id;
  await s.procurement.claimTask(BUYER, itemId);
  await s.orders.raisePriceIncrease(ADMIN, itemId, { new_unit_price_cents: 6000 });

  s.clockState.ms += 25 * 3600 * 1000; // past the 24h deadline
  await assert.rejects(() => s.finance.paySurcharge(USER, itemId), (e) => e.statusCode === 409);
});

test("refundItem credits the wallet back and is idempotent per business object", async () => {
  const s = stack();
  const first = await s.finance.refundItem(USER.id, "item-xyz", 4000, { reason: "cancel" });
  assert.equal(first.wallet.available_cny_minor, 4000);
  const second = await s.finance.refundItem(USER.id, "item-xyz", 4000, { reason: "cancel" });
  assert.equal(second.replay, true);
  assert.equal((await s.finance.getBalance(USER.id)).wallet.available_cny_minor, 4000); // refunded once
});
