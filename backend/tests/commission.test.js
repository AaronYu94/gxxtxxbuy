import assert from "node:assert/strict";
import test from "node:test";
import { createCommissionService } from "../src/commission/commission-service.js";
import { MemoryCommissionRepository } from "./helpers/memory-commission-repository.js";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";

const PROMOTER = "pppppppp-pppp-pppp-pppp-pppppppppppp";
const INVITEE = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";

function build() {
  const referralRepo = new MemoryReferralRepository();
  const referralService = createReferralService({ repository: referralRepo });
  const repository = new MemoryCommissionRepository();
  const svc = createCommissionService({ repository, referralService });
  return { referralRepo, referralService, repository, svc };
}

async function bindInvitee(referralService, referralRepo) {
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  await referralService.bindOnSignup(INVITEE, code);
}

// ---- V2-11-07 signed-parcel commission ----
test("a signed parcel generates commission at the promoter's rate, snapshotted", async () => {
  const { referralRepo, referralService, repository, svc } = build();
  await bindInvitee(referralService, referralRepo);
  // base 200000; default P1 rate 3.5% → 7000.
  const res = await svc.generateOnSigned({ parcelId: "parcel-1", inviteeUserId: INVITEE, baseMinor: 200000 });
  assert.equal(res.generated, true);
  assert.equal(res.commission_cny_minor, 7000);
  assert.equal(res.promoter_user_id, PROMOTER);
  const w = await svc.getWallet({ id: PROMOTER });
  assert.equal(w.wallet.available_cny_minor, 7000);
});

test("commission generation is idempotent per parcel (triple-confirmation safe)", async () => {
  const { referralRepo, referralService, repository, svc } = build();
  await bindInvitee(referralService, referralRepo);
  await svc.generateOnSigned({ parcelId: "parcel-2", inviteeUserId: INVITEE, baseMinor: 200000 });
  const replay = await svc.generateOnSigned({ parcelId: "parcel-2", inviteeUserId: INVITEE, baseMinor: 200000 });
  assert.equal(replay.generated, false);
  assert.equal((await svc.getWallet({ id: PROMOTER })).wallet.available_cny_minor, 7000); // not doubled
});

test("no commission when the buyer has no inviter", async () => {
  const { svc } = build();
  const res = await svc.generateOnSigned({ parcelId: "parcel-3", inviteeUserId: "no-inviter", baseMinor: 200000 });
  assert.equal(res.generated, false);
  assert.equal(res.reason, "no_promoter");
});

test("the commission ledger is balanced (recompute sums to zero)", async () => {
  const { referralRepo, referralService, repository, svc } = build();
  await bindInvitee(referralService, referralRepo);
  // base 400000 stays in P1 (below the 500000 P2 threshold) → 3.5%.
  await svc.generateOnSigned({ parcelId: "parcel-4", inviteeUserId: INVITEE, baseMinor: 400000 });
  // Every entry has a matching opposite entry → the whole ledger nets to zero.
  assert.equal(await repository.ledgerSum(), 0);
  // The promoter's available equals the platform pool's debit magnitude.
  const w = await svc.getWallet({ id: PROMOTER });
  assert.equal(w.wallet.available_cny_minor, Math.floor(400000 * 350 / 10000));
});

test("commission is isolated from the normal wallet (its own account namespace)", async () => {
  const { referralRepo, referralService, repository, svc } = build();
  await bindInvitee(referralService, referralRepo);
  await svc.generateOnSigned({ parcelId: "parcel-5", inviteeUserId: INVITEE, baseMinor: 200000 });
  // The credited account is the commission namespace, never user:*:available.
  const commissionAcct = `commission:${PROMOTER}:available`;
  assert.equal(await repository.balance(commissionAcct), 7000);
  assert.equal(await repository.balance(`user:${PROMOTER}:available`), 0);
});
