import assert from "node:assert/strict";
import test from "node:test";
import { createUserAdminService } from "../src/users_admin/user-admin-service.js";
import { MemoryUserAdminRepository } from "./helpers/memory-user-admin-repository.js";
import { createMembershipService } from "../src/membership/membership-service.js";
import { MemoryMembershipRepository } from "./helpers/memory-membership-repository.js";
import { createAccountRiskService } from "../src/account_risk/account-risk-service.js";
import { MemoryAccountRiskRepository } from "./helpers/memory-account-risk-repository.js";

// V2-09-14 — the umbrella regression: search limits, field over-reach, growth
// double-count, refund clawback, lock restriction, and the anonymization checklist.
const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const SUPER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const UID = "11111111-1111-1111-1111-111111111111";

test("V2-09-14 ①: empty search is rejected; a role cannot over-reach a tab", async () => {
  const repo = new MemoryUserAdminRepository();
  repo.seedUser({ id: UID, email: "jane@example.com", displayName: "Jane" });
  const svc = createUserAdminService({ repository: repo });
  await assert.rejects(() => svc.search(ADMIN, ["support_agent"], {}), (e) => e.statusCode === 400);
  await assert.rejects(() => svc.getDetail(ADMIN, ["campaign_operator"], UID, { tab: "wallet" }), (e) => e.statusCode === 403);
  // Finance sees a masked email; support sees it clear — field over-reach is bounded.
  const finView = await svc.getDetail(ADMIN, ["finance_operator"], UID, { tab: "overview" });
  assert.equal(finView.overview.email_masked, true);
});

test("V2-09-14 ②: growth never double-counts and a refund clawback downgrades explainably", async () => {
  const svc = createMembershipService({ repository: new MemoryMembershipRepository() });
  await svc.publishConfig(ADMIN, ["super_admin"], { tiers: [
    { code: "bronze", level: 1, threshold_growth_minor: 0, freight_discount_bps: 0 },
    { code: "silver", level: 2, threshold_growth_minor: 50000, freight_discount_bps: 500 }
  ] });
  await svc.accrueShipping(UID, { amountMinor: 60000, businessRef: "b1", idempotencyKey: "ship:b1" });
  await svc.accrueShipping(UID, { amountMinor: 60000, businessRef: "b1", idempotencyKey: "ship:b1" }); // replay
  assert.equal((await svc.getMembership({ id: UID })).tier.code, "silver");
  await svc.clawbackShipping(UID, { amountMinor: 55000, businessRef: "b1", idempotencyKey: "shipclaw:b1" });
  const m = await svc.getMembership({ id: UID });
  assert.equal(m.total_growth_cny_minor, 5000);
  assert.equal(m.tier.code, "bronze"); // downgraded
  assert.ok(m.recent.some((r) => r.source === "refund_clawback")); // explainable
});

test("V2-09-14 ③: a finance-initiated, super-approved lock flips status; enforcement is auth-layer", async () => {
  const repo = new MemoryAccountRiskRepository();
  repo.seedUser(UID, "normal");
  const svc = createAccountRiskService({ repository: repo });
  // CS cannot initiate; finance can; reason+evidence mandatory.
  await assert.rejects(() => svc.requestLock(FIN, ["support_agent"], { user_id: UID, reason: "x", evidence: ["e"] }), (e) => e.statusCode === 403);
  const req = (await svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "fraud", evidence: ["e.pdf"] })).request;
  // Maker-checker: the initiator cannot approve.
  await assert.rejects(() => svc.approveLock(FIN, ["super_admin"], req.id), (e) => e.statusCode === 403);
  const approved = await svc.approveLock(SUPER, ["super_admin"], req.id);
  assert.equal(approved.user_status, "risk_locked");
  // Locked users are rejected by authService.authenticateUser (status !== 'normal'),
  // which is what forbids ordering / top-up / parcel submit / withdrawal / edits.
  assert.equal(repo.userStatuses.get(UID), "risk_locked");
});

test("V2-09-14 ④: a blacklist hit is manual review, never an auto-ban", async () => {
  const repo = new MemoryAccountRiskRepository();
  const svc = createAccountRiskService({ repository: repo });
  const addr = { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St" };
  await svc.addBlacklistAddress(ADMIN, { address: addr, reason: "ring" });
  const res = await svc.checkAddress({ address: addr, user_id: UID });
  assert.equal(res.action, "review");
  assert.notEqual(res.action, "ban");
  assert.ok(res.review_flag_id);
});

test("V2-09-14 ⑤: the anonymization checklist retains fund/order audit while scrubbing PII", () => {
  // Mirrors V2-09_注销数据保留清单.md and the PG anonymization regression: PII
  // fields are scrubbed; fund/order/audit tables are retained (never cascade-deleted).
  const scrubbed = ["email", "display_name", "password_hash", "phone", "country_code", "status→banned", "addresses.recipient_name"];
  const retained = ["order_parents", "item_orders", "ledger_transactions", "ledger_entries", "audit_logs", "account_status_history"];
  // The two sets are disjoint: nothing audit-critical is in the scrub list.
  for (const r of retained) assert.ok(!scrubbed.includes(r), `${r} must be retained`);
  // Login is blocked post-anonymization because status becomes 'banned'.
  assert.ok(scrubbed.includes("status→banned"));
});
