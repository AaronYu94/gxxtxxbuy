import assert from "node:assert/strict";
import test from "node:test";
import { computeTier, validateTiers } from "../src/membership/membership-tiers.js";
import { createMembershipService } from "../src/membership/membership-service.js";
import { MemoryMembershipRepository } from "./helpers/memory-membership-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const USER = { id: "11111111-1111-1111-1111-111111111111" };

const TIERS = [
  { code: "bronze", name: "Bronze", level: 1, threshold_growth_minor: 0, freight_discount_bps: 0 },
  { code: "silver", name: "Silver", level: 2, threshold_growth_minor: 50000, freight_discount_bps: 500 },
  { code: "gold", name: "Gold", level: 3, threshold_growth_minor: 200000, freight_discount_bps: 1000 }
];

// ---- pure tier math ----
test("computeTier lands a growth total in the right tier + reports the next", () => {
  assert.equal(computeTier(0, TIERS).tier.code, "bronze");
  assert.equal(computeTier(60000, TIERS).tier.code, "silver");
  assert.equal(computeTier(60000, TIERS).to_next_minor, 140000);
  assert.equal(computeTier(999999, TIERS).tier.code, "gold");
  assert.equal(computeTier(999999, TIERS).next_tier, null);
});

test("tier validation enforces a 0-threshold base and strictly increasing ladder", () => {
  assert.equal(validateTiers(TIERS).ok, true);
  assert.equal(validateTiers([]).ok, false);
  assert.equal(validateTiers([{ code: "x", level: 1, threshold_growth_minor: 100, freight_discount_bps: 0 }]).ok, false);
});

function build() {
  const repository = new MemoryMembershipRepository();
  const svc = createMembershipService({ repository });
  return { repository, svc };
}

test("only a super admin can publish tier config", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.publishConfig(ADMIN, ["campaign_operator"], { tiers: TIERS }), (e) => e.statusCode === 403);
  const res = await svc.publishConfig(ADMIN, ["super_admin"], { tiers: TIERS });
  assert.equal(res.config.version, 1);
  assert.equal(res.config.active, true);
});

test("growth accrues only from paid shipping and is idempotent per event", async () => {
  const { svc } = build();
  await svc.publishConfig(ADMIN, ["super_admin"], { tiers: TIERS });
  await svc.accrueShipping(USER.id, { amountMinor: 30000, businessRef: "bill-1", idempotencyKey: "ship:bill-1" });
  // Replaying the same payment event does not double-count.
  await svc.accrueShipping(USER.id, { amountMinor: 30000, businessRef: "bill-1", idempotencyKey: "ship:bill-1" });
  await svc.accrueShipping(USER.id, { amountMinor: 30000, businessRef: "bill-2", idempotencyKey: "ship:bill-2" });

  const m = await svc.getMembership(USER);
  assert.equal(m.total_growth_cny_minor, 60000);
  assert.equal(m.tier.code, "silver");
  assert.equal(m.freight_discount_bps, 500);
});

test("a refund claws growth back and can downgrade the tier explainably", async () => {
  const { svc } = build();
  await svc.publishConfig(ADMIN, ["super_admin"], { tiers: TIERS });
  await svc.accrueShipping(USER.id, { amountMinor: 220000, businessRef: "b1", idempotencyKey: "ship:b1" });
  assert.equal((await svc.getMembership(USER)).tier.code, "gold");

  await svc.clawbackShipping(USER.id, { amountMinor: 200000, businessRef: "b1", idempotencyKey: "shipclaw:b1" });
  const m = await svc.getMembership(USER);
  assert.equal(m.total_growth_cny_minor, 20000);
  assert.equal(m.tier.code, "bronze"); // downgraded, and the ledger explains why
  assert.ok(m.recent.some((r) => r.source === "refund_clawback"));
});

test("the membership provider resolves a live freight discount for the billing seam", async () => {
  const { svc } = build();
  await svc.publishConfig(ADMIN, ["super_admin"], { tiers: TIERS });
  const provider = svc.membershipProvider();
  assert.equal(await provider.forUser(USER.id), null); // no growth yet → no discount
  await svc.accrueShipping(USER.id, { amountMinor: 60000, businessRef: "b", idempotencyKey: "ship:b" });
  assert.deepEqual(await provider.forUser(USER.id), { discountBps: 500 });
});
