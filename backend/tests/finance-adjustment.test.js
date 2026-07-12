import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const USER = "44444444-4444-4444-4444-444444444444";
const FINANCE = { id: "55555555-5555-5555-5555-555555555555" };
const SUPER = { id: "99999999-9999-9999-9999-999999999999" };

function service(env = {}) {
  return createFinanceService({ repository: new MemoryFinanceRepository(), env });
}

test("a credit adjustment: finance creates, super-admin approves, wallet credited once", async () => {
  const fin = service();
  const { adjustment } = await fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 50, reason: "goodwill" });
  assert.equal(adjustment.status, "pending_review");

  const approved = await fin.approveAdjustment(SUPER, ["super_admin"], adjustment.id);
  assert.equal(approved.adjustment.status, "executed");
  assert.equal((await fin.getBalance(USER)).wallet.available_cny_minor, 5000);

  // Re-approving an already-executed adjustment is refused (already handled) —
  // and the ledger idempotency key guarantees no second credit regardless.
  await assert.rejects(() => fin.approveAdjustment(SUPER, ["super_admin"], adjustment.id), (e) => e.statusCode === 409);
  assert.equal((await fin.getBalance(USER)).wallet.available_cny_minor, 5000);
});

test("the initiator cannot approve their own adjustment, and non-super-admins cannot approve", async () => {
  const fin = service();
  const { adjustment } = await fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 50, reason: "x" });
  await assert.rejects(() => fin.approveAdjustment(FINANCE, ["super_admin"], adjustment.id), (e) => e.statusCode === 403);
  await assert.rejects(() => fin.approveAdjustment(SUPER, ["finance"], adjustment.id), (e) => e.statusCode === 403);
});

test("a debit adjustment beyond balance lands on execution_failed (diagnosable), not a silent drop", async () => {
  const fin = service();
  const { adjustment } = await fin.createAdjustment(FINANCE, { user_id: USER, direction: "debit", amount: 50, reason: "clawback" });
  const result = await fin.approveAdjustment(SUPER, ["super_admin"], adjustment.id);
  assert.equal(result.failed, true);
  assert.equal(result.adjustment.status, "execution_failed");
  assert.equal(result.adjustment.failure_reason, "insufficient_balance");
});

test("single-transaction and daily limits are enforced", async () => {
  const fin = service({ adjustSingleLimitMinor: 10000, adjustDailyLimitMinor: 15000 });
  // Over single limit.
  await assert.rejects(() => fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 200, reason: "x" }), (e) => e.statusCode === 400);
  // First within limits, executed.
  const a1 = (await fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 100, reason: "x" })).adjustment;
  await fin.approveAdjustment(SUPER, ["super_admin"], a1.id);
  // Second would exceed the daily total (10000 + 10000 > 15000).
  await assert.rejects(() => fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 100, reason: "x" }), (e) => e.statusCode === 409);
});

test("reject leaves the wallet untouched", async () => {
  const fin = service();
  const { adjustment } = await fin.createAdjustment(FINANCE, { user_id: USER, direction: "credit", amount: 50, reason: "x" });
  const rejected = await fin.rejectAdjustment(SUPER, adjustment.id, { reason: "insufficient evidence" });
  assert.equal(rejected.adjustment.status, "rejected");
  assert.equal((await fin.getBalance(USER)).wallet.available_cny_minor, 0);
});
