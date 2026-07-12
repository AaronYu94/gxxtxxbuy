import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };

function service() {
  return createFinanceService({ repository: new MemoryFinanceRepository() });
}

test("requesting a withdrawal freezes the amount immediately; overdraw is refused", async () => {
  const fin = service();
  await fin.credit(USER.id, 10000, {});
  const { withdrawal } = await fin.requestWithdrawal(USER, { amount: 40 });
  assert.equal(withdrawal.status, "pending_review");
  const w = (await fin.getBalance(USER.id)).wallet;
  assert.equal(w.available_cny_minor, 6000);
  assert.equal(w.frozen_cny_minor, 4000);

  await assert.rejects(() => fin.requestWithdrawal(USER, { amount: 100 }), (e) => e.statusCode === 409);
});

test("approve → execute settles the frozen amount once (no double refund)", async () => {
  const fin = service();
  await fin.credit(USER.id, 10000, {});
  const { withdrawal } = await fin.requestWithdrawal(USER, { amount: 40 });
  await fin.reviewWithdrawal(ADMIN, withdrawal.id, { decision: "approve" });
  const done = await fin.executeWithdrawal(ADMIN, withdrawal.id);
  assert.equal(done.withdrawal.status, "succeeded");
  const w = (await fin.getBalance(USER.id)).wallet;
  assert.equal(w.available_cny_minor, 6000);
  assert.equal(w.frozen_cny_minor, 0); // settled out

  const replay = await fin.executeWithdrawal(ADMIN, withdrawal.id);
  assert.equal(replay.replay, true);
  assert.equal((await fin.getBalance(USER.id)).wallet.frozen_cny_minor, 0); // no second refund
});

test("reject unfreezes the amount back to available", async () => {
  const fin = service();
  await fin.credit(USER.id, 10000, {});
  const { withdrawal } = await fin.requestWithdrawal(USER, { amount: 40 });
  const rejected = await fin.reviewWithdrawal(ADMIN, withdrawal.id, { decision: "reject", reason: "risk" });
  assert.equal(rejected.withdrawal.status, "rejected");
  const w = (await fin.getBalance(USER.id)).wallet;
  assert.equal(w.available_cny_minor, 10000);
  assert.equal(w.frozen_cny_minor, 0);
});

test("executing a withdrawal that is not in processing is rejected", async () => {
  const fin = service();
  await fin.credit(USER.id, 10000, {});
  const { withdrawal } = await fin.requestWithdrawal(USER, { amount: 40 });
  // still pending_review, not processing
  await assert.rejects(() => fin.executeWithdrawal(ADMIN, withdrawal.id), (e) => e.statusCode === 409);
});
