import assert from "node:assert/strict";
import test from "node:test";
import { validateTiers, computeTier, DEFAULT_TIERS } from "../src/referral/referral-tiers.js";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const SUPER = ["super_admin"];
const P = "pppppppp-pppp-pppp-pppp-pppppppppppp";

// ---- V2-11-04 pure tiers ----
test("the default ladder is 5 tiers, 3.5%→7.5%, four thresholds", () => {
  assert.equal(DEFAULT_TIERS.length, 5);
  assert.equal(DEFAULT_TIERS[0].commission_bps, 350);
  assert.equal(DEFAULT_TIERS[4].commission_bps, 750);
  assert.equal(validateTiers(DEFAULT_TIERS).ok, true);
});

test("tier validation requires strictly increasing level/threshold/rate from 0", () => {
  assert.equal(validateTiers([]).ok, false);
  assert.equal(validateTiers([{ code: "x", level: 1, threshold_minor: 100, commission_bps: 350 }]).ok, false); // base not 0
  assert.equal(validateTiers([{ code: "a", level: 1, threshold_minor: 0, commission_bps: 500 }, { code: "b", level: 2, threshold_minor: 100, commission_bps: 400 }]).ok, false); // rate not increasing
});

test("computeTier maps a cumulative amount to one tier + next", () => {
  assert.equal(computeTier(0, DEFAULT_TIERS).tier.code, "P1");
  assert.equal(computeTier(600000, DEFAULT_TIERS).tier.code, "P2");
  assert.equal(computeTier(600000, DEFAULT_TIERS).commission_bps, 450);
  assert.equal(computeTier(99999999, DEFAULT_TIERS).tier.code, "P5");
  assert.equal(computeTier(99999999, DEFAULT_TIERS).next_tier, null);
});

function build() {
  const repository = new MemoryReferralRepository();
  const svc = createReferralService({ repository });
  return { repository, svc };
}

test("publishing tiers is super-admin only and versioned", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.publishTierConfig(ADMIN, ["referral_operator"], { tiers: DEFAULT_TIERS }), (e) => e.statusCode === 403);
  const res = await svc.publishTierConfig(ADMIN, SUPER, { tiers: DEFAULT_TIERS });
  assert.equal(res.config.version, 1);
});

// ---- V2-11-05 effective amount + level ----
test("effective amount accrues idempotently and drives promoter level; refund claws back", async () => {
  const { svc } = build();
  // Without config, the default ladder applies.
  await svc.accrueEffective(P, { amountMinor: 300000, businessRef: "b1", idempotencyKey: "eff:b1" });
  await svc.accrueEffective(P, { amountMinor: 300000, businessRef: "b1", idempotencyKey: "eff:b1" }); // replay
  await svc.accrueEffective(P, { amountMinor: 300000, businessRef: "b2", idempotencyKey: "eff:b2" });
  let level = await svc.getPromoterLevel(P);
  assert.equal(level.total_effective_cny_minor, 600000); // not 900000
  assert.equal(level.tier_code, "P2");
  assert.equal(level.commission_bps, 450);

  // A refund claws back the effective amount → could downgrade.
  await svc.clawbackEffective(P, { amountMinor: 200000, businessRef: "b1", idempotencyKey: "effclaw:b1" });
  level = await svc.getPromoterLevel(P);
  assert.equal(level.total_effective_cny_minor, 400000);
  assert.equal(level.tier_code, "P1"); // downgraded below P2 threshold
});

test("uses the published config's rates when present", async () => {
  const { svc } = build();
  await svc.publishTierConfig(ADMIN, SUPER, { tiers: [
    { code: "A", level: 1, threshold_minor: 0, commission_bps: 400 },
    { code: "B", level: 2, threshold_minor: 100000, commission_bps: 800 }
  ] });
  await svc.accrueEffective(P, { amountMinor: 150000, businessRef: "x", idempotencyKey: "eff:x" });
  const level = await svc.getPromoterLevel(P);
  assert.equal(level.tier_code, "B");
  assert.equal(level.commission_bps, 800);
});
