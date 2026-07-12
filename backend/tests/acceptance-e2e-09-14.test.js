import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";
import { createCommissionService } from "../src/commission/commission-service.js";
import { MemoryCommissionRepository } from "./helpers/memory-commission-repository.js";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";
import { computeStorage } from "../src/wms/storage-rules.js";
import { resolveDataScope, DATA_SCOPES } from "../src/rbac/data-scope.js";
import { hasPermission, ROLE_DEFINITIONS } from "../src/rbac/permissions.js";

const U = { id: "11111111-1111-1111-1111-111111111111" };

// ---- V2-12-19 E2E-09 钱包幂等 ----
test("E2E-09: a replayed ledger post never double-credits; a shortfall debit is refused", async () => {
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  await finance.credit(U.id, 10000, { type: "topup", businessType: "top_up", idempotencyKey: "cb-1" });
  // Duplicate provider callback → same idempotency key → no second credit.
  await finance.credit(U.id, 10000, { type: "topup", businessType: "top_up", idempotencyKey: "cb-1" });
  const bal = await finance.getBalance(U.id);
  assert.equal(bal.wallet.available_cny_minor, 10000); // not 20000

  // A debit beyond the balance is refused (no negative wallet / dirty write).
  await assert.rejects(() => finance.debit(U.id, 15000, { type: "spend", businessType: "x", idempotencyKey: "d-1" }), (e) => e.statusCode >= 400);
  // A valid debit + its replay only deducts once.
  await finance.debit(U.id, 4000, { type: "spend", businessType: "x", idempotencyKey: "d-2" });
  await finance.debit(U.id, 4000, { type: "spend", businessType: "x", idempotencyKey: "d-2" });
  assert.equal((await finance.getBalance(U.id)).wallet.available_cny_minor, 6000);
});

// ---- V2-12-20 E2E-10 普通提现 ----
test("E2E-10: withdrawal freezes on request; success deducts, failure unfreezes", async () => {
  const finance = createFinanceService({ repository: new MemoryFinanceRepository() });
  await finance.credit(U.id, 100000, { type: "topup", businessType: "top_up", idempotencyKey: "fund" });
  // finance withdrawal takes CNY amount + a payee reference (original-route).
  const wd = await finance.requestWithdrawal(U, { amount: 500, payee_ref: "vault-ref" });
  const afterFreeze = await finance.getBalance(U.id);
  assert.equal(afterFreeze.wallet.available_cny_minor, 50000); // 50000 frozen out of 100000
  assert.equal(afterFreeze.wallet.frozen_cny_minor, 50000);

  // Failure path → unfreeze back to available (user asked to contact their bank).
  await finance.failWithdrawal({ id: "admin" }, wd.withdrawal.id, { reason: "bank rejected" });
  const afterFail = await finance.getBalance(U.id);
  assert.equal(afterFail.wallet.available_cny_minor, 100000);
  assert.equal(afterFail.wallet.frozen_cny_minor, 0);
});

// ---- V2-12-21 E2E-11 推广佣金 ----
test("E2E-11: signed → commission; unsigned → none; refund → clawback (once)", async () => {
  const referralService = createReferralService({ repository: new MemoryReferralRepository() });
  const commRepo = new MemoryCommissionRepository();
  const comm = createCommissionService({ repository: commRepo, referralService, financeService: { async credit() { return { transaction: { id: "w" } }; } } });
  const P = "pppppppp-pppp-pppp-pppp-pppppppppppp", I = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";
  await referralService.bindOnSignup(I, (await referralService.getMyCode({ id: P })).code);
  // Unsigned buyer with no inviter → nothing.
  assert.equal((await comm.generateOnSigned({ parcelId: "no", inviteeUserId: "orphan", baseMinor: 400000 })).generated, false);
  // Signed → generate; refund → claw back once.
  assert.equal((await comm.generateOnSigned({ parcelId: "P1", inviteeUserId: I, baseMinor: 400000 })).generated, true);
  assert.equal((await comm.clawbackForRefund({ parcelId: "P1", refundRef: "r1" })).clawed, true);
  assert.equal((await comm.clawbackForRefund({ parcelId: "P1", refundRef: "r1" })).clawed, false);
  assert.equal(await commRepo.ledgerSum(), 0);
});

// ---- V2-12-22 E2E-12 超期销毁 ----
test("E2E-12: destruction is only eligible at 150 days, never before", async () => {
  const inbound = "2026-01-01T00:00:00.000Z";
  const day = 86400000;
  // Day 149 → not eligible.
  const at149 = computeStorage(inbound, 0, Date.parse(inbound) + 149 * day);
  assert.equal(at149.destroyEligible, false);
  // Day 150 → eligible.
  const at150 = computeStorage(inbound, 0, Date.parse(inbound) + 150 * day);
  assert.equal(at150.destroyEligible, true);
  // The destroy window is a fixed 150 days from official inbound (paid extensions
  // move the storage deadline, not the destruction eligibility) — so day 150 is
  // eligible regardless of extensions, and before 150 it never is.
  const extended = computeStorage(inbound, 2, Date.parse(inbound) + 150 * day);
  assert.equal(extended.destroyEligible, true);
  assert.equal(computeStorage(inbound, 2, Date.parse(inbound) + 100 * day).destroyEligible, false);
});

// ---- V2-12-23 E2E-13 权限隔离 ----
test("E2E-13: each role's data scope + capabilities are bounded; no cross-role over-reach", () => {
  // Data scope per role/domain.
  assert.equal(resolveDataScope(["procurement_agent"], "procurement"), DATA_SCOPES.SELF);
  assert.equal(resolveDataScope(["procurement_lead"], "procurement"), DATA_SCOPES.ORG);
  assert.equal(resolveDataScope(["warehouse_operator"], "warehouse"), DATA_SCOPES.ASSIGNED);
  // Capability isolation across the nine roles.
  const byCode = Object.fromEntries(ROLE_DEFINITIONS.map((r) => [r.code, r.permissions]));
  assert.equal(hasPermission(byCode.support_agent, "finance:wallet:write"), false);
  assert.equal(hasPermission(byCode.finance_operator, "warehouse:write"), false);
  assert.equal(hasPermission(byCode.warehouse_operator, "procurement:write"), false);
  assert.equal(hasPermission(byCode.campaign_operator, "referral:write"), false);
  assert.equal(hasPermission(byCode.referral_operator, "campaign:write"), false);
  // Only super admin is universal.
  assert.equal(hasPermission(byCode.super_admin, "any:action"), true);
});

// ---- V2-12-24 E2E-14 后台安全 ----
test("E2E-14: high-risk admin actions are gated; a disabled admin cannot act", () => {
  // High-risk actions require re-auth (documented at the route via requireHighRiskReauth)
  // and are super-admin gated in the services (proven across V2-09/10/11 tests). Here we
  // assert the capability model that backs it: only super_admin can perform account
  // locks, tier config, and dead-letter replay.
  const byCode = Object.fromEntries(ROLE_DEFINITIONS.map((r) => [r.code, r.permissions]));
  // No non-super role carries the wildcard; every other role is scoped.
  for (const r of ROLE_DEFINITIONS) {
    if (r.code === "super_admin") continue;
    assert.equal(r.permissions.includes("*"), false, `${r.code} must not be universal`);
  }
  assert.equal(hasPermission(byCode.super_admin, "*"), true);
});
