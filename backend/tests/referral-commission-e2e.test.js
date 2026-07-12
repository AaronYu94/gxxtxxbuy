import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";
import { createCommissionService } from "../src/commission/commission-service.js";
import { MemoryCommissionRepository } from "./helpers/memory-commission-repository.js";

// V2-11-14 — invitation → commission end to end.
const PROMOTER = "pppppppp-pppp-pppp-pppp-pppppppppppp";
const INVITEE = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const OPS = { id: "99999999-9999-9999-9999-999999999999" };

function build() {
  const referralRepo = new MemoryReferralRepository();
  const referralService = createReferralService({ repository: referralRepo });
  const commissionRepo = new MemoryCommissionRepository();
  const wallet = { credits: [], keys: new Set() };
  const financeService = { async credit(u, a, o) { if (o?.idempotencyKey && wallet.keys.has(o.idempotencyKey)) return { transaction: { id: "d" } }; if (o?.idempotencyKey) wallet.keys.add(o.idempotencyKey); wallet.credits.push({ u, a }); return { transaction: { id: "w" } }; } };
  const commissionService = createCommissionService({ repository: commissionRepo, referralService, financeService });
  return { referralService, referralRepo, commissionService, commissionRepo, wallet };
}

test("E2E: bind → sign → commission → transfer → withdraw → clawback, all consistent", async () => {
  const { referralService, commissionService, commissionRepo, wallet } = build();

  // (1) Bind + self-invite guard.
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  assert.equal((await referralService.bindOnSignup(PROMOTER, code)).reason, "self_invite");
  assert.equal((await referralService.bindOnSignup(INVITEE, code)).bound, true);

  // (2) No commission before signing.
  assert.equal((await commissionService.getWallet({ id: PROMOTER })).wallet.available_cny_minor, 0);

  // (3) Sign a parcel → commission generated once (repeat-signing is a no-op).
  await commissionService.generateOnSigned({ parcelId: "P1", inviteeUserId: INVITEE, baseMinor: 1000000 }); // base 1M → P2 (>=500000) 4.5% = 45000
  await commissionService.generateOnSigned({ parcelId: "P1", inviteeUserId: INVITEE, baseMinor: 1000000 }); // replay
  const w1 = (await commissionService.getWallet({ id: PROMOTER })).wallet;
  assert.equal(w1.available_cny_minor, 45000);

  // (4) Transfer part to the normal wallet (zero-fee).
  await commissionService.transferToBalance({ id: PROMOTER }, { amount_cny_minor: 20000, idempotency_key: "t1" });
  assert.equal(wallet.credits[0].a, 20000);
  assert.equal((await commissionService.getWallet({ id: PROMOTER })).wallet.available_cny_minor, 25000);

  // Fund enough for a withdrawal (min 2000 CNY = 200000).
  await commissionService.generateOnSigned({ parcelId: "P2", inviteeUserId: INVITEE, baseMinor: 6000000 }); // pushes to P4/P5 territory
  const avail = (await commissionService.getWallet({ id: PROMOTER })).wallet.available_cny_minor;

  // (5) Withdraw → freeze → approve → pay (idempotent), card isolated.
  const wd = (await commissionService.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 200000, bank_account_ref: "vault", bank_last4: "9999", idempotency_key: "wd1" })).withdrawal;
  assert.equal(wd.bank_last4, "9999");
  await commissionService.reviewWithdrawal(FIN, wd.id, { decision: "approve" });
  await commissionService.payWithdrawal(FIN, wd.id);
  await commissionService.payWithdrawal(FIN, wd.id); // idempotent
  const afterWd = await commissionRepo.wallet(PROMOTER);
  assert.equal(afterWd.settled >= 200000, true);
  assert.equal(afterWd.frozen, 0);

  // (6) A refund on P1 claws back exactly its commission, once.
  const c1 = await commissionService.clawbackForRefund({ parcelId: "P1", refundRef: "r1" });
  assert.equal(c1.clawed, true);
  assert.equal(c1.amount_cny_minor, 45000);
  assert.equal((await commissionService.clawbackForRefund({ parcelId: "P1", refundRef: "r1" })).clawed, false);

  // (7) The commission ledger is always balanced (recompute check).
  assert.equal(await commissionRepo.ledgerSum(), 0);
});

test("E2E: a buyer with no inviter never generates commission; discipline blocks withdrawal", async () => {
  const { referralService, commissionService } = build();
  // No inviter → no commission.
  assert.equal((await commissionService.generateOnSigned({ parcelId: "X", inviteeUserId: "orphan", baseMinor: 1000000 })).generated, false);

  // Fund + freeze the promoter → withdrawal blocked.
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  await referralService.bindOnSignup(INVITEE, code);
  await commissionService.generateOnSigned({ parcelId: "Y", inviteeUserId: INVITEE, baseMinor: 6000000 });
  await commissionService.discipline(OPS, ["referral_operator"], { promoter_user_id: PROMOTER, action: "freeze", reason: "abuse", evidence: ["e.pdf"] });
  await assert.rejects(() => commissionService.requestWithdrawal({ id: PROMOTER }, { amount_cny_minor: 200000, bank_account_ref: "v", idempotency_key: "z" }), (e) => e.statusCode === 409);
});

test("E2E: back-office privacy — promotion ops see no amounts; relationship correction needs double confirm", () => {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("../../app/referral-admin.js", import.meta.url), "utf8"), context, { filename: "referral-admin.js" });
  const M = window.GoatedBuyReferralAdmin;
  assert.equal(M.canSeeAmounts("referral_operator"), false);
  assert.equal(M.canSeeAmounts("finance_operator"), true);
  assert.equal(M.amountDisplay("referral_operator", 45000), "•••"); // masked for promotion ops
  assert.equal(M.amountDisplay("finance_operator", 45000), "45000");
  assert.equal(M.can("finance_operator", "pay_withdrawal"), true);
  assert.equal(M.can("referral_operator", "pay_withdrawal"), false); // finance only handles payment
  assert.equal(M.can("referral_operator", "correct_relationship"), false);
  assert.equal(M.can("super_admin", "correct_relationship"), true);
  assert.equal(M.requiresDoubleConfirm("correct_relationship"), true);
  assert.deepEqual(Array.from(M.withdrawalActions("processing", "finance_operator")), ["pay", "fail"]);
});
