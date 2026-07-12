import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";
import { createStubPaymentProvider } from "../src/finance/payment-provider.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };

function setup() {
  const provider = createStubPaymentProvider({ secret: "test-secret-123456" });
  return { fin: createFinanceService({ repository: new MemoryFinanceRepository(), paymentProvider: provider, env: {} }), provider };
}

async function makeTopUp(fin, amountYuan) {
  return (await fin.createTopUp(USER, { amount: amountYuan, currency: "CNY" })).top_up;
}

test("top-up exception workbench lists failed/exception top-ups", async () => {
  const { fin, provider } = setup();
  const top = await makeTopUp(fin, 100);
  // A mismatched webhook marks it as an exception.
  const body = { provider_txn_id: `stub_${top.top_up_no}`, amount_minor: 5000, currency: "CNY", status: "succeeded" };
  await assert.rejects(() => fin.handlePaymentWebhook({ body, signature: provider.signBody(body) }), (e) => e.statusCode === 409);

  const { top_ups } = await fin.listTopUpExceptions({});
  assert.equal(top_ups.length, 1);
  assert.equal(top_ups[0].system_status, "exception");
});

test("reconciliation records diffs, is idempotent by file hash, and never auto-adjusts the wallet", async () => {
  const { fin, provider } = setup();
  const a = await makeTopUp(fin, 100); // 10000
  const b = await makeTopUp(fin, 50);  // 5000

  // Settle A so it matches.
  const okBody = { provider_txn_id: `stub_${a.top_up_no}`, amount_minor: 10000, currency: "CNY", status: "succeeded" };
  await fin.handlePaymentWebhook({ body: okBody, signature: provider.signBody(okBody) });
  const availableBefore = (await fin.getBalance(USER.id)).wallet.available_cny_minor; // 10000

  const records = [
    { provider_txn_id: `stub_${a.top_up_no}`, amount_minor: 10000, currency: "CNY", status: "succeeded" }, // match → no diff
    { provider_txn_id: `stub_${b.top_up_no}`, amount_minor: 9999, currency: "CNY", status: "succeeded" },  // amount_mismatch
    { provider_txn_id: "stub_UNKNOWN", amount_minor: 1234, currency: "CNY", status: "succeeded" }          // missing_local
  ];
  const first = await fin.importReconciliation(ADMIN, { file_hash: "file-abc", records });
  assert.equal(first.existing, false);
  assert.equal(first.batch.record_count, 3);
  assert.equal(first.batch.diff_count, 2);
  const types = first.diffs.map((d) => d.diff_type).sort();
  assert.deepEqual(types, ["amount_mismatch", "missing_local"]);

  // Re-importing the same file is idempotent.
  const again = await fin.importReconciliation(ADMIN, { file_hash: "file-abc", records });
  assert.equal(again.existing, true);
  assert.equal(again.batch.diff_count, 2);

  // Reconciliation never moved money.
  assert.equal((await fin.getBalance(USER.id)).wallet.available_cny_minor, availableBefore);
});
