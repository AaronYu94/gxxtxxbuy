import assert from "node:assert/strict";
import test from "node:test";
import { createCommissionService } from "../src/commission/commission-service.js";
import { MemoryCommissionRepository } from "./helpers/memory-commission-repository.js";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";

const PROMOTER = "pppppppp-pppp-pppp-pppp-pppppppppppp";
const INVITEE = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const OPS = { id: "99999999-9999-9999-9999-999999999999" };

function build() {
  const referralService = createReferralService({ repository: new MemoryReferralRepository() });
  const repository = new MemoryCommissionRepository();
  const svc = createCommissionService({ repository, referralService, financeService: { async credit() { return { transaction: { id: "w" } }; } } });
  return { referralService, repository, svc };
}

// Give the promoter a big available balance via several signed parcels.
async function fund(referralService, svc, total = 300000) {
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  await referralService.bindOnSignup(INVITEE, code);
  // base × 3.5% = commission; to reach ~300000 available at 3.5% we need base ~8.57M.
  // Simpler: bump the level so rate applies; use a large base.
  await svc.generateOnSigned({ parcelId: "big", inviteeUserId: INVITEE, baseMinor: Math.ceil(total / 0.035) });
}

// ---- V2-11-10 withdrawal ----
test("withdrawal below 2000 CNY is rejected", async () => {
  const { referralService, svc } = build();
  await fund(referralService, svc);
  await assert.rejects(() => svc.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 100000, bank_account_ref: "bank-ref-1", idempotency_key: "w1" }), (e) => e.statusCode === 400);
});

test("withdrawal freezes, review approves, payment settles once; card is isolated", async () => {
  const { referralService, repository, svc } = build();
  await fund(referralService, svc, 300000);
  const before = await repository.wallet(PROMOTER);
  const wd = (await svc.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 200000, bank_account_ref: "vault-token-xyz", bank_last4: "4321", idempotency_key: "w1" })).withdrawal;
  assert.equal(wd.bank_last4, "4321");
  assert.equal(wd.status, "pending_review");
  // Frozen moved out of available.
  const afterFreeze = await repository.wallet(PROMOTER);
  assert.equal(afterFreeze.available, before.available - 200000);
  assert.equal(afterFreeze.frozen, 200000);

  await svc.reviewWithdrawal(FIN, wd.id, { decision: "approve" });
  const paid = await svc.payWithdrawal(FIN, wd.id);
  assert.equal(paid.withdrawal.status, "succeeded");
  const settled = await repository.wallet(PROMOTER);
  assert.equal(settled.frozen, 0);
  assert.equal(settled.settled, 200000);
  // Paying again is idempotent (no double payout).
  await svc.payWithdrawal(FIN, wd.id);
  assert.equal((await repository.wallet(PROMOTER)).settled, 200000);
});

test("a rejected/failed withdrawal unfreezes back to available", async () => {
  const { referralService, repository, svc } = build();
  await fund(referralService, svc, 300000);
  const wd = (await svc.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 200000, bank_account_ref: "b", idempotency_key: "w2" })).withdrawal;
  const availBefore = (await repository.wallet(PROMOTER)).available;
  await svc.reviewWithdrawal(FIN, wd.id, { decision: "reject", reason: "mismatch" });
  const w = await repository.wallet(PROMOTER);
  assert.equal(w.frozen, 0);
  assert.equal(w.available, availBefore + 200000); // unfrozen
});

// ---- V2-11-11 discipline ----
test("freeze/disqualify require reason + evidence; disqualify needs confirmation", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.discipline(OPS, ["referral_operator"], { promoter_user_id: PROMOTER, action: "freeze", reason: "x" }), (e) => e.statusCode === 400); // no evidence
  await assert.rejects(() => svc.discipline(OPS, ["referral_operator"], { promoter_user_id: PROMOTER, action: "disqualify", reason: "fraud", evidence: ["e"] }), (e) => e.statusCode === 400); // no confirm
  const frozen = await svc.discipline(OPS, ["referral_operator"], { promoter_user_id: PROMOTER, action: "freeze", reason: "suspicious", evidence: ["report.pdf"] });
  assert.equal(frozen.qualification.status, "frozen");
});

test("a frozen promoter cannot withdraw", async () => {
  const { referralService, svc } = build();
  await fund(referralService, svc, 300000);
  await svc.discipline(OPS, ["referral_operator"], { promoter_user_id: PROMOTER, action: "freeze", reason: "x", evidence: ["e"] });
  await assert.rejects(() => svc.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 200000, bank_account_ref: "b", idempotency_key: "w3" }), (e) => e.statusCode === 409);
});

// ---- V2-11-12 clawback ----
test("a refund claws back the exact commission once; a second refund is a no-op", async () => {
  const { referralService, repository, svc } = build();
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  await referralService.bindOnSignup(INVITEE, code);
  await svc.generateOnSigned({ parcelId: "parcelX", inviteeUserId: INVITEE, baseMinor: 400000 }); // 14000
  const before = (await repository.wallet(PROMOTER)).available;

  const c1 = await svc.clawbackForRefund({ parcelId: "parcelX", refundRef: "refund-1" });
  assert.equal(c1.clawed, true);
  assert.equal(c1.amount_cny_minor, 14000);
  assert.equal((await repository.wallet(PROMOTER)).available, before - 14000);
  // Same refund again → no-op (same idempotency key).
  const c2 = await svc.clawbackForRefund({ parcelId: "parcelX", refundRef: "refund-1" });
  assert.equal(c2.clawed, false);
  assert.equal(await repository.ledgerSum(), 0); // still balanced
});
