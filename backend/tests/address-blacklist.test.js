import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { strictFingerprint, fuzzyKey, verdict } from "../src/account_risk/address-fingerprint.js";
import { createAccountRiskService } from "../src/account_risk/account-risk-service.js";
import { MemoryAccountRiskRepository } from "./helpers/memory-account-risk-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };

// ---- V2-09-11 pure fingerprints ----
test("strict fingerprint normalizes and fuzzy key uses country+postal+house", () => {
  const a = { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St.", line2: "Apt 4" };
  const b = { country_code: "us", postal_code: "90001", city: "la", line1: "123  main   st", line2: "apt 4" };
  assert.equal(strictFingerprint(a), strictFingerprint(b)); // case/space/punct-insensitive
  assert.equal(fuzzyKey(a), "us|90001|123");
});

test("a match verdict is always 'review', never an auto-ban", () => {
  assert.equal(verdict({ exact: { id: "x" } }).action, "review");
  assert.equal(verdict({ fuzzy: [{ id: "y" }] }).action, "review");
  assert.equal(verdict({ exact: null, fuzzy: [] }).action, "clear");
});

function build() {
  const repository = new MemoryAccountRiskRepository();
  const svc = createAccountRiskService({ repository });
  return { repository, svc };
}

test("an exact blacklist hit creates a pending review flag (no auto-ban)", async () => {
  const { svc } = build();
  const addr = { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St", line2: "Apt 4" };
  await svc.addBlacklistAddress(ADMIN, { address: addr, reason: "fraud ring" });
  const res = await svc.checkAddress({ address: addr, user_id: "u1" });
  assert.equal(res.matched, true);
  assert.equal(res.kind, "exact");
  assert.equal(res.action, "review");
  assert.ok(res.review_flag_id);
  const flags = (await svc.listReviewFlags({})).flags;
  assert.equal(flags[0].status, "pending");
});

test("a near-duplicate address is a fuzzy hit → review", async () => {
  const { svc } = build();
  await svc.addBlacklistAddress(ADMIN, { address: { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St", line2: "Apt 4" }, reason: "x" });
  // Same house + postal, different unit → fuzzy, not exact.
  const res = await svc.checkAddress({ address: { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St", line2: "Apt 9" } });
  assert.equal(res.kind, "fuzzy");
  assert.equal(res.action, "review");
});

test("a clean address matches nothing and creates no flag", async () => {
  const { svc } = build();
  await svc.addBlacklistAddress(ADMIN, { address: { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St" }, reason: "x" });
  const res = await svc.checkAddress({ address: { country_code: "GB", postal_code: "SW1A", city: "London", line1: "10 Downing St" } });
  assert.equal(res.matched, false);
  assert.equal(res.review_flag_id, null);
});

test("a review flag is decided by an operator", async () => {
  const { svc } = build();
  const addr = { country_code: "US", postal_code: "90001", city: "LA", line1: "123 Main St" };
  await svc.addBlacklistAddress(ADMIN, { address: addr, reason: "x" });
  const flagId = (await svc.checkAddress({ address: addr })).review_flag_id;
  await assert.rejects(() => svc.decideReviewFlag(ADMIN, flagId, { decision: "nope" }), (e) => e.statusCode === 400);
  const done = await svc.decideReviewFlag(ADMIN, flagId, { decision: "confirmed" });
  assert.equal(done.flag.status, "confirmed");
});

// ---- V2-09-12 back-office frontend ----
test("account-risk back-office: only finance/super operate; matches are review", () => {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("../../app/account-risk.js", import.meta.url), "utf8"), context, { filename: "account-risk.js" });
  const M = window.GoatedBuyAccountRisk;
  assert.equal(M.canOperate("finance_operator"), true);
  assert.equal(M.canOperate("support_agent"), false);
  assert.deepEqual(Array.from(M.lockRequestActions("pending_review", "super_admin")), ["approve", "reject"]);
  assert.equal(Array.from(M.lockRequestActions("pending_review", "finance_operator")).length, 0);
  assert.equal(M.isAutoBan(), false);
  assert.match(M.verdictLabel("exact"), /review/i);
});
