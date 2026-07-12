import assert from "node:assert/strict";
import test from "node:test";
import { createUserAdminService } from "../src/users_admin/user-admin-service.js";
import { MemoryUserAdminRepository } from "./helpers/memory-user-admin-repository.js";
import { maskEmail, tailorOverview, tabsForRole } from "../src/users_admin/user-view.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const UID = "11111111-1111-1111-1111-111111111111";

function build() {
  const repository = new MemoryUserAdminRepository();
  const svc = createUserAdminService({ repository });
  repository.seedUser({ id: UID, email: "jane@example.com", displayName: "Jane", phone: "+8613800001111" });
  repository.linkOrder("GO-PO-123", UID);
  repository.linkParcel("GO-PKG-9", UID);
  return { repository, svc };
}

// ---- V2-09-02 pure view ----
test("email masking hides the local part", () => {
  assert.equal(maskEmail("jane@example.com"), "ja***@example.com");
  assert.equal(maskEmail("ab@x.com"), "ab@x.com");
});

test("finance sees masked contact; support sees it in the clear", () => {
  const user = { id: UID, email: "jane@example.com", phone: "+8613800001111", displayName: "Jane", status: "normal" };
  assert.equal(tailorOverview(user, "finance_operator").email_masked, true);
  assert.equal(tailorOverview(user, "support_agent").email_masked, false);
  assert.equal(tailorOverview(user, "support_agent").email, "jane@example.com");
});

test("role tab sets differ", () => {
  assert.ok(tabsForRole("finance_operator").includes("wallet"));
  assert.ok(!tabsForRole("campaign_operator").includes("wallet"));
});

// ---- V2-09-01 search ----
test("an empty search is a 400", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.search(ADMIN, ["support_agent"], {}), (e) => e.statusCode === 400);
});

test("search resolves by email, order number, and parcel number", async () => {
  const { svc } = build();
  assert.equal((await svc.search(ADMIN, ["support_agent"], { email: "jane@example.com" })).results[0].id, UID);
  assert.equal((await svc.search(ADMIN, ["support_agent"], { order_no: "GO-PO-123" })).results[0].id, UID);
  assert.equal((await svc.search(ADMIN, ["support_agent"], { parcel_no: "GO-PKG-9" })).results[0].id, UID);
  // Results are always masked in the list.
  assert.equal((await svc.search(ADMIN, ["support_agent"], { email: "jane@example.com" })).results[0].email_masked, "ja***@example.com");
});

// ---- V2-09-02 detail role gate ----
test("a role cannot open a tab it is not allowed", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.getDetail(ADMIN, ["campaign_operator"], UID, { tab: "wallet" }), (e) => e.statusCode === 403);
  const ok = await svc.getDetail(ADMIN, ["finance_operator"], UID, { tab: "wallet" });
  assert.ok(ok.wallet);
});

// ---- V2-09-03 assist edit ----
test("assist edit requires an identity-verification note", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.assistEdit(ADMIN, ["support_agent"], UID, { phone: "+8613900000000" }), (e) => e.statusCode === 400);
});

test("changing the email requires re-verification", async () => {
  const { repository, svc } = build();
  const res = await svc.assistEdit(ADMIN, ["support_agent"], UID, { identity_verification: "ticket #55, phone match", email: "new@example.com" });
  assert.equal(res.email_reverification_required, true);
  assert.equal(repository.users.get(UID).emailVerifiedAt, null);
});

test("a locked account cannot be edited", async () => {
  const { repository, svc } = build();
  repository.users.get(UID).status = "risk_locked";
  await assert.rejects(() => svc.assistEdit(ADMIN, ["support_agent"], UID, { identity_verification: "v", phone: "+1" }), (e) => e.statusCode === 409);
});
