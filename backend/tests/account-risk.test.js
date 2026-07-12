import assert from "node:assert/strict";
import test from "node:test";
import { createAccountRiskService } from "../src/account_risk/account-risk-service.js";
import { MemoryAccountRiskRepository } from "./helpers/memory-account-risk-repository.js";

const FIN = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
const FIN2 = { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" };
const SUPER = { id: "99999999-9999-9999-9999-999999999999" };
const UID = "11111111-1111-1111-1111-111111111111";

function build({ autoRulesEnabled = false } = {}) {
  const repository = new MemoryAccountRiskRepository();
  repository.seedUser(UID, "normal");
  const svc = createAccountRiskService({ repository, autoRulesEnabled });
  return { repository, svc };
}

// ---- V2-09-08 events ----
test("a risk event is idempotent per external id and hides raw evidence", async () => {
  const { svc } = build();
  const first = await svc.recordEvent(FIN, { user_id: UID, type: "chargeback", severity: "high", external_id: "evt-1", evidence_ref: "s3://secret" });
  assert.equal(first.recorded, true);
  const replay = await svc.recordEvent(FIN, { user_id: UID, type: "chargeback", severity: "high", external_id: "evt-1" });
  assert.equal(replay.recorded, false);
  const events = (await svc.listEvents(UID)).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].has_evidence, true);
  assert.equal(events[0].evidence_ref, undefined); // raw ref never surfaced
});

test("auto-rules are off by default; a high-severity event raises no lock request", async () => {
  const { svc } = build({ autoRulesEnabled: false });
  const r = await svc.recordEvent(FIN, { user_id: UID, type: "payment", severity: "high", external_id: "e2" });
  assert.equal(r.auto_lock_request_id, null);
});

test("auto-rules on: a high-severity event raises a pending lock request", async () => {
  const { svc } = build({ autoRulesEnabled: true });
  const r = await svc.recordEvent(FIN, { user_id: UID, type: "payment", severity: "high", external_id: "e3" });
  assert.ok(r.auto_lock_request_id);
});

// ---- V2-09-09 lock request ----
test("only finance initiates; reason and evidence are mandatory; no duplicates", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.requestLock(SUPER, ["support_agent"], { user_id: UID, reason: "x", evidence: ["e"] }), (e) => e.statusCode === 403);
  await assert.rejects(() => svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "x", evidence: [] }), (e) => e.statusCode === 400);
  const req = await svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "fraud", evidence: ["report.pdf"] });
  assert.equal(req.request.status, "pending_review");
  await assert.rejects(() => svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "again", evidence: ["e"] }), (e) => e.statusCode === 409);
});

// ---- V2-09-10 approval + enforcement ----
test("super-admin approval locks the account (enforcement is at the auth layer)", async () => {
  const { repository, svc } = build();
  const req = (await svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "fraud", evidence: ["e"], target_status: "risk_locked" })).request;
  // The initiator cannot approve their own request.
  await assert.rejects(() => svc.approveLock(FIN, ["super_admin"], req.id), (e) => e.statusCode === 403);
  const approved = await svc.approveLock(SUPER, ["super_admin"], req.id);
  assert.equal(approved.user_status, "risk_locked");
  assert.equal(repository.userStatuses.get(UID), "risk_locked");
  // A locked user's session is rejected by authenticateUser (status !== 'normal').

  const status = await svc.getAccountStatus(UID);
  assert.equal(status.status, "risk_locked");
  assert.equal(status.history[status.history.length - 1].to_status, "risk_locked");
});

test("unlock restores the account and records history", async () => {
  const { repository, svc } = build();
  const req = (await svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "x", evidence: ["e"] })).request;
  await svc.approveLock(SUPER, ["super_admin"], req.id);
  const unlocked = await svc.unlock(SUPER, ["super_admin"], { user_id: UID, reason: "cleared" });
  assert.equal(unlocked.user_status, "normal");
  assert.equal(repository.userStatuses.get(UID), "normal");
  // Only super-admin can unlock.
  await assert.rejects(() => svc.unlock(FIN, ["finance_operator"], { user_id: UID }), (e) => e.statusCode === 403);
});

test("rejecting a lock request leaves the account normal", async () => {
  const { repository, svc } = build();
  const req = (await svc.requestLock(FIN, ["finance_operator"], { user_id: UID, reason: "x", evidence: ["e"] })).request;
  const rejected = await svc.rejectLock(SUPER, ["super_admin"], req.id, { reason: "insufficient" });
  assert.equal(rejected.request.status, "rejected");
  assert.equal(repository.userStatuses.get(UID), "normal");
});
