import assert from "node:assert/strict";
import test from "node:test";
import { createReferralService } from "../src/referral/referral-service.js";
import { MemoryReferralRepository } from "./helpers/memory-referral-repository.js";

const A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const C = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc" };

function build() {
  const repository = new MemoryReferralRepository();
  const svc = createReferralService({ repository, officialBaseUrl: "https://official" });
  return { repository, svc };
}

// ---- V2-11-02 code / link / QR ----
test("code is generated once and reused; QR encodes only the official link", async () => {
  const { svc } = build();
  const first = await svc.getMyCode(A);
  const again = await svc.getMyCode(A);
  assert.equal(first.code, again.code); // repeated generation → same code
  assert.match(first.link, /^https:\/\/official\/signup\?ref=/);
  assert.equal(first.qr_payload, first.link); // QR is only the official link
});

// ---- V2-11-03 signup binding ----
test("binding attributes an invitee to an inviter, once and permanently", async () => {
  const { repository, svc } = build();
  const code = (await svc.getMyCode(A)).code; // A's code
  const res = await svc.bindOnSignup(B.id, code);
  assert.equal(res.bound, true);
  assert.equal(res.inviter_user_id, A.id);
  // Re-binding is a no-op (permanent).
  const again = await svc.bindOnSignup(B.id, code);
  assert.equal(again.bound, false);
  assert.equal(again.reason, "already_bound");
});

test("an invalid code does not block signup; it records a reason", async () => {
  const { repository, svc } = build();
  const res = await svc.bindOnSignup(B.id, "GO-INV-NOPE");
  assert.equal(res.bound, false);
  assert.equal(res.reason, "invalid_code");
  assert.ok(repository.attempts.some((a) => a.reason === "invalid_code"));
});

test("self-invite is rejected", async () => {
  const { svc } = build();
  const code = (await svc.getMyCode(A)).code;
  const res = await svc.bindOnSignup(A.id, code); // A tries to use own code
  assert.equal(res.bound, false);
  assert.equal(res.reason, "self_invite");
});

test("a cycle is rejected (A→B→C, then C's code cannot bind A)", async () => {
  const { svc } = build();
  const aCode = (await svc.getMyCode(A)).code;
  await svc.bindOnSignup(B.id, aCode); // B invited by A
  const bCode = (await svc.getMyCode(B)).code;
  await svc.bindOnSignup(C.id, bCode); // C invited by B
  const cCode = (await svc.getMyCode(C)).code;
  const res = await svc.bindOnSignup(A.id, cCode); // A invited by C → cycle
  assert.equal(res.bound, false);
  assert.equal(res.reason, "cycle");
});

test("invitee count reflects bindings", async () => {
  const { svc } = build();
  const aCode = (await svc.getMyCode(A)).code;
  await svc.bindOnSignup(B.id, aCode);
  await svc.bindOnSignup(C.id, aCode);
  const mine = await svc.getMyReferral(A);
  assert.equal(mine.invitee_count, 2);
  assert.equal(mine.has_inviter, false);
});
