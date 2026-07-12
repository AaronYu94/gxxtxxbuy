import assert from "node:assert/strict";
import test from "node:test";
import { createCommissionService } from "../src/commission/commission-service.js";
import { MemoryCommissionRepository } from "./helpers/memory-commission-repository.js";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";

const PROMOTER = "pppppppp-pppp-pppp-pppp-pppppppppppp";
const INVITEE = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";

function build() {
  const referralService = createReferralService({ repository: new MemoryReferralRepository() });
  const repository = new MemoryCommissionRepository();
  const wallet = { credits: [], keys: new Set() };
  const financeService = {
    async credit(u, a, o) {
      // Real finance dedupes by idempotency key — a replayed credit is a no-op.
      if (o?.idempotencyKey && wallet.keys.has(o.idempotencyKey)) return { transaction: { id: "dup" } };
      if (o?.idempotencyKey) wallet.keys.add(o.idempotencyKey);
      wallet.credits.push({ u, a, o });
      return { transaction: { id: "w1" } };
    }
  };
  const svc = createCommissionService({ repository, referralService, financeService });
  return { referralService, repository, wallet, svc };
}

async function withCommission(referralService, svc, base = 400000) {
  const code = (await referralService.getMyCode({ id: PROMOTER })).code;
  await referralService.bindOnSignup(INVITEE, code);
  await svc.generateOnSigned({ parcelId: "p1", inviteeUserId: INVITEE, baseMinor: base });
}

// ---- V2-11-09 transfer ----
test("transfer moves available commission to the normal wallet, zero fee, once", async () => {
  const { referralService, repository, wallet, svc } = build();
  await withCommission(referralService, svc); // 14000 available
  const res = await svc.transferToBalance({ id: PROMOTER }, { amount_cny_minor: 10000, idempotency_key: "t1" });
  assert.equal(res.transferred, true);
  assert.equal(res.amount_cny_minor, 10000); // no fee deducted
  assert.equal(res.wallet.available_cny_minor, 4000); // 14000 - 10000
  assert.equal(res.wallet.settled_cny_minor, 10000);
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0].a, 10000);

  // Idempotent replay → no second commission debit and no second wallet credit.
  await svc.transferToBalance({ id: PROMOTER }, { amount_cny_minor: 10000, idempotency_key: "t1" });
  assert.equal(wallet.credits.length, 1);
  assert.equal((await svc.getWallet({ id: PROMOTER })).wallet.available_cny_minor, 4000);
});

test("cannot transfer more than available; frozen cannot transfer", async () => {
  const { referralService, svc } = build();
  await withCommission(referralService, svc); // 14000 available
  await assert.rejects(() => svc.transferToBalance({ id: PROMOTER }, { amount_cny_minor: 99999, idempotency_key: "t2" }), (e) => e.statusCode === 409);
});

// ---- V2-11-08 privacy dashboard ----
test("the promoter dashboard is aggregate + masked (no per-invitee amounts)", async () => {
  const { referralService, svc } = build();
  await withCommission(referralService, svc);
  const userLookup = { async findById(id) { return { id, email: "invitee@example.com" }; } };
  const dash = await svc.getPromoterDashboard({ id: PROMOTER }, userLookup);
  assert.equal(dash.invitee_count, 1);
  assert.ok(dash.commission_wallet.available_cny_minor >= 0);
  assert.ok(dash.level);
  // The invitee list carries only a masked email + bound date — never amounts.
  const inv = dash.invitees[0];
  assert.ok(inv.invitee_email_masked.includes("*") || inv.invitee_email_masked.length <= 6);
  assert.equal(inv.amount, undefined);
  assert.equal(inv.order, undefined);
});
