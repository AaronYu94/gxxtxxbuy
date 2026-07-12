import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";
import { assertBalanced } from "../src/finance/finance-repository.js";

const USER = "44444444-4444-4444-4444-444444444444";

function service() {
  return createFinanceService({ repository: new MemoryFinanceRepository() });
}

test("credit raises available; debit lowers it; recompute matches the projection", async () => {
  const svc = service();
  await svc.credit(USER, 10000, { type: "top_up" });
  await svc.debit(USER, 3000, { type: "order_payment" });
  const { wallet } = await svc.getBalance(USER);
  assert.equal(wallet.available_cny_minor, 7000);

  const recomputed = await svc.recompute(USER);
  assert.equal(recomputed.availableCnyMinor, 7000); // balance is derivable from the ledger
});

test("debit beyond available is refused (409) and leaves no partial state", async () => {
  const svc = service();
  await svc.credit(USER, 5000, {});
  await assert.rejects(() => svc.debit(USER, 9000, {}), (e) => e.statusCode === 409);
  const { wallet } = await svc.getBalance(USER);
  assert.equal(wallet.available_cny_minor, 5000); // unchanged
});

test("freeze moves available → frozen and unfreeze reverses it", async () => {
  const svc = service();
  await svc.credit(USER, 10000, {});
  await svc.freeze(USER, 4000, {});
  let w = (await svc.getBalance(USER)).wallet;
  assert.equal(w.available_cny_minor, 6000);
  assert.equal(w.frozen_cny_minor, 4000);

  await svc.unfreeze(USER, 4000, {});
  w = (await svc.getBalance(USER)).wallet;
  assert.equal(w.available_cny_minor, 10000);
  assert.equal(w.frozen_cny_minor, 0);

  // Cannot freeze more than available.
  await assert.rejects(() => svc.freeze(USER, 99999, {}), (e) => e.statusCode === 409);
});

test("an idempotency key makes a repeated post a no-op replay", async () => {
  const svc = service();
  const first = await svc.credit(USER, 5000, { idempotencyKey: "topup-1" });
  assert.equal(first.replay, false);
  const second = await svc.credit(USER, 5000, { idempotencyKey: "topup-1" });
  assert.equal(second.replay, true);
  const { wallet } = await svc.getBalance(USER);
  assert.equal(wallet.available_cny_minor, 5000); // credited once, not twice
});

test("every transaction's entries must balance (debits == credits)", () => {
  assert.throws(() => assertBalanced([
    { account: "a", direction: "debit", amountMinor: 100 },
    { account: "b", direction: "credit", amountMinor: 90 }
  ]), /Unbalanced/);
  assert.doesNotThrow(() => assertBalanced([
    { account: "a", direction: "debit", amountMinor: 100 },
    { account: "b", direction: "credit", amountMinor: 100 }
  ]));
});

test("refund credits available back from an external source", async () => {
  const svc = service();
  await svc.credit(USER, 10000, {});
  await svc.debit(USER, 6000, { type: "order_payment" });
  await svc.refund(USER, 6000, { type: "order_refund" });
  const { wallet } = await svc.getBalance(USER);
  assert.equal(wallet.available_cny_minor, 10000);
});
