import assert from "node:assert/strict";
import test from "node:test";
import { computeBilling, packingSubtotal, PACKING_BASE_FEE_CNY_MINOR } from "../src/consolidation/billing.js";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const USER = { id: "11111111-1111-1111-1111-111111111111" };

// ---- V2-07-09 pure billing order ----
test("billing applies membership before coupon, floored, never below zero", () => {
  // subtotal 10000; 10% membership → 1000 off; coupon 20% of 9000 → 1800 off.
  const r = computeBilling({ subtotalMinor: 10000, membership: { discountBps: 1000 }, coupon: { type: "percent", bps: 2000 } });
  assert.equal(r.membership_discount_cny_minor, 1000);
  assert.equal(r.coupon_discount_cny_minor, 1800);
  assert.equal(r.total_cny_minor, 7200);
});

test("a fixed coupon is capped at the post-membership amount", () => {
  const r = computeBilling({ subtotalMinor: 5000, membership: { discountBps: 2000 }, coupon: { type: "fixed", valueMinor: 999999 } });
  assert.equal(r.membership_discount_cny_minor, 1000); // 20% of 5000
  assert.equal(r.coupon_discount_cny_minor, 4000);     // capped at 4000, not 999999
  assert.equal(r.total_cny_minor, 0);
});

test("no membership and no coupon is a clean no-op", () => {
  const r = computeBilling({ subtotalMinor: 3000 });
  assert.equal(r.total_cny_minor, 3000);
  assert.equal(r.membership_discount_cny_minor, 0);
  assert.equal(r.coupon_discount_cny_minor, 0);
});

test("packing subtotal is the base fee plus value-added-service prices", () => {
  assert.equal(packingSubtotal([{ priceCnyMinor: 1500 }, { priceCnyMinor: 500 }]), PACKING_BASE_FEE_CNY_MINOR + 2000);
});

// ---- V2-07-08/10 submit + cancel flow over the service ----
function build({ membership = null, coupon = null } = {}) {
  const repository = new MemoryConsolidationRepository();
  const wallet = { debits: [], refunds: [] };
  const financeService = {
    async debit(userId, amount, opts) { wallet.debits.push({ userId, amount, opts }); return { transaction: { id: "tx" } }; },
    async refund(userId, amount, opts) { wallet.refunds.push({ userId, amount, opts }); return { transaction: { id: "rx" } }; }
  };
  const membershipProvider = membership ? { async forUser() { return membership; } } : null;
  const couponProvider = coupon ? { async resolve() { return coupon; } } : null;
  const svc = createConsolidationService({ repository, financeService, membershipProvider, couponProvider });
  return { repository, svc, wallet };
}

test("submitting a parcel produces a payable packing bill; paying advances it", async () => {
  const { repository, svc, wallet } = build();
  repository.seedInventory({ stockNo: "GO-STOCK-P1", userId: USER.id });
  await svc.createValueAddedService(ADMIN, ["super_admin"], { code: "reinforce", price_cny_minor: 1500 });
  const created = await svc.createParcel(USER, { stock_nos: ["GO-STOCK-P1"], value_added_service_codes: ["reinforce"] });
  const id = created.parcel.id;

  const submitted = await svc.submitParcel(USER, id, {});
  assert.equal(submitted.parcel.status, "packing_fee_due");
  assert.equal(submitted.bills.length, 1);
  assert.equal(submitted.bills[0].kind, "packing");
  assert.equal(submitted.bills[0].total_cny_minor, PACKING_BASE_FEE_CNY_MINOR + 1500);

  const paid = await svc.payPackingBill(USER, id);
  assert.equal(paid.parcel.status, "warehouse_acceptance_pending");
  assert.equal(paid.bills[0].status, "paid");
  assert.equal(wallet.debits.length, 1);
  assert.equal(wallet.debits[0].amount, PACKING_BASE_FEE_CNY_MINOR + 1500);

  // Paying again is idempotent (no second debit).
  await svc.payPackingBill(USER, id);
  assert.equal(wallet.debits.length, 1);
});

test("cancelling before packing releases the stock and refunds a paid bill", async () => {
  const { repository, svc, wallet } = build();
  const unit = repository.seedInventory({ stockNo: "GO-STOCK-P2", userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: ["GO-STOCK-P2"] });
  const id = created.parcel.id;
  await svc.submitParcel(USER, id, {});
  await svc.payPackingBill(USER, id);
  assert.equal(repository.inventory.get("GO-STOCK-P2").status, "reserved");

  const cancelled = await svc.cancelParcel(USER, id);
  assert.equal(cancelled.parcel.status, "cancelled");
  // Stock returned to the pool and eligible again.
  assert.equal(repository.inventory.get("GO-STOCK-P2").status, "in_stock");
  const eligible = (await svc.listEligibleStock(USER)).eligible_stock;
  assert.deepEqual(eligible.map((e) => e.stock_no), ["GO-STOCK-P2"]);
  // Paid bill refunded.
  assert.equal(wallet.refunds.length, 1);
  assert.equal(cancelled.bills[0].status, "refunded");
});

test("a coupon discount flows into the packing bill total", async () => {
  const { repository, svc } = build({ coupon: { type: "fixed", valueMinor: 300 } });
  repository.seedInventory({ stockNo: "GO-STOCK-P3", userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: ["GO-STOCK-P3"] });
  const submitted = await svc.submitParcel(USER, created.parcel.id, { coupon_code: "SAVE3" });
  assert.equal(submitted.bills[0].coupon_discount_cny_minor, 300);
  assert.equal(submitted.bills[0].total_cny_minor, PACKING_BASE_FEE_CNY_MINOR - 300);
});
