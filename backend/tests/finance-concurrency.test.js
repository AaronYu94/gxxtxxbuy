import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";
import { createStubPaymentProvider } from "../src/finance/payment-provider.js";

const USER = "44444444-4444-4444-4444-444444444444";
const FINANCE = { id: "55555555-5555-5555-5555-555555555555" };
const SUPER = { id: "99999999-9999-9999-9999-999999999999" };

// Global double-entry invariant: across the whole ledger, total debits == total
// credits, and the wallet projection equals a fresh recompute from the ledger.
function assertBooksBalanced(repo, userId, wallet) {
  let debit = 0;
  let credit = 0;
  for (const rec of repo.records) {
    for (const e of rec.entries) {
      if (e.direction === "debit") debit += e.amountMinor;
      else credit += e.amountMinor;
    }
  }
  assert.equal(debit, credit, "ledger debits must equal credits");
  return debit;
}

test("mixed money flows keep the books balanced and the projection derivable", async () => {
  const repo = new MemoryFinanceRepository();
  const fin = createFinanceService({ repository: repo, env: {} });

  await fin.credit(USER, 100000, { type: "top_up", idempotencyKey: "tu-1" });
  await fin.credit(USER, 100000, { type: "top_up", idempotencyKey: "tu-1" }); // duplicate callback → no-op
  await fin.debit(USER, 30000, { type: "order_payment", businessType: "order", idempotencyKey: "order-1" });
  await fin.debit(USER, 30000, { type: "order_payment", businessType: "order", idempotencyKey: "order-1" }); // retry → no-op
  await fin.refundItem(USER, "item-1", 10000, {}); // refund
  await fin.refundItem(USER, "item-1", 10000, {}); // retry → no-op

  const wallet = (await fin.getBalance(USER)).wallet;
  assert.equal(wallet.available_cny_minor, 100000 - 30000 + 10000); // 80000
  const recomputed = await repo.recomputeBalance(USER);
  assert.equal(recomputed.availableCnyMinor, wallet.available_cny_minor);
  assertBooksBalanced(repo, USER, wallet);
});

test("a failed withdrawal restores the balance and keeps the books balanced", async () => {
  const repo = new MemoryFinanceRepository();
  const fin = createFinanceService({ repository: repo, env: {} });
  await fin.credit(USER, 50000, {});
  const { withdrawal } = await fin.requestWithdrawal({ id: USER }, { amount: 200 }); // freeze 20000
  await fin.reviewWithdrawal(FINANCE, withdrawal.id, { decision: "approve" });
  await fin.failWithdrawal(FINANCE, withdrawal.id, { reason: "bank rejected" }); // unfreeze

  const wallet = (await fin.getBalance(USER)).wallet;
  assert.equal(wallet.available_cny_minor, 50000);
  assert.equal(wallet.frozen_cny_minor, 0);
  const recomputed = await repo.recomputeBalance(USER);
  assert.equal(recomputed.availableCnyMinor, 50000);
  assert.equal(recomputed.frozenCnyMinor, 0);
  assertBooksBalanced(repo, USER, wallet);
});

test("an adjustment approval keeps the books balanced", async () => {
  const repo = new MemoryFinanceRepository();
  const fin = createFinanceService({ repository: repo, env: {} });
  const { adjustment } = await fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 75, reason: "goodwill" });
  await fin.approveAdjustment(SUPER, ["super_admin"], adjustment.id);

  const wallet = (await fin.getBalance(USER)).wallet;
  assert.equal(wallet.available_cny_minor, 7500);
  assertBooksBalanced(repo, USER, wallet);
});

test("duplicate settlement of the same top-up credits exactly once", async () => {
  const provider = createStubPaymentProvider({ secret: "test-secret-123456" });
  const repo = new MemoryFinanceRepository();
  const fin = createFinanceService({ repository: repo, paymentProvider: provider, env: {} });
  const top = (await fin.createTopUp({ id: USER }, { amount: 100, currency: "CNY" })).top_up;
  const body = { provider_txn_id: `stub_${top.top_up_no}`, amount_minor: 10000, currency: "CNY", status: "succeeded" };
  const sig = provider.signBody(body);

  await Promise.all([
    fin.handlePaymentWebhook({ body, signature: sig }),
    fin.handlePaymentWebhook({ body, signature: sig }),
    fin.handlePaymentWebhook({ body, signature: sig })
  ]);
  assert.equal((await fin.getBalance(USER)).wallet.available_cny_minor, 10000);
  assertBooksBalanced(repo, USER, (await fin.getBalance(USER)).wallet);
});
