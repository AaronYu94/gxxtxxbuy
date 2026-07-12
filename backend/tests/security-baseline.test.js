import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission, ROLE_DEFINITIONS } from "../src/rbac/permissions.js";
import { verifyPrivateObjectSignature, signPrivateObjectUrl } from "../src/storage/signed-url.js";
import { redactLogFields, publicErrorMessage } from "../src/utils/redact.js";
import { createUserAdminService } from "../src/users_admin/user-admin-service.js";
import { MemoryUserAdminRepository } from "./helpers/memory-user-admin-repository.js";

// ---- V2-12-10 authorization: no cross-role over-reach ----
test("no non-privileged role holds finance/super capabilities", () => {
  const roleByCode = Object.fromEntries(ROLE_DEFINITIONS.map((r) => [r.code, r.permissions]));
  // A support agent must not have finance wallet write or config write.
  assert.equal(hasPermission(roleByCode.support_agent, "finance:wallet:write"), false);
  assert.equal(hasPermission(roleByCode.support_agent, "config:write"), false);
  // A warehouse operator must not touch procurement or finance.
  assert.equal(hasPermission(roleByCode.warehouse_operator, "procurement:write"), false);
  assert.equal(hasPermission(roleByCode.warehouse_operator, "finance:write"), false);
  // A campaign operator must not have warehouse or finance.
  assert.equal(hasPermission(roleByCode.campaign_operator, "warehouse:write"), false);
  // Only super admin has the wildcard.
  assert.equal(hasPermission(roleByCode.super_admin, "anything:at:all"), true);
});

test("a role cannot open a user-detail tab it is not entitled to", async () => {
  const repo = new MemoryUserAdminRepository();
  repo.seedUser({ id: "11111111-1111-1111-1111-111111111111", email: "a@x.com" });
  const svc = createUserAdminService({ repository: repo });
  // Campaign operator has no wallet tab → 403 (direct URL over-reach fails).
  await assert.rejects(() => svc.getDetail({ id: "admin" }, ["campaign_operator"], "11111111-1111-1111-1111-111111111111", { tab: "wallet" }), (e) => e.statusCode === 403);
});

// ---- injection safety ----
test("a malicious search string cannot escape a parameterized query (no crash, no match)", async () => {
  const repo = new MemoryUserAdminRepository();
  repo.seedUser({ id: "11111111-1111-1111-1111-111111111111", email: "jane@x.com" });
  const svc = createUserAdminService({ repository: repo });
  // Classic injection payload — treated as a literal, matches nothing, no error.
  const res = await svc.search({ id: "admin" }, ["support_agent"], { email: "' OR 1=1; DROP TABLE users;--" });
  assert.equal(res.results.length, 0);
});

// ---- private file access: signature required + expiry ----
test("private object URLs require a valid, unexpired signature", () => {
  const secret = "test-secret-1234";
  const url = signPrivateObjectUrl({ key: "qc/front.jpg", baseUrl: "https://x", secret, expiresInSeconds: 600, now: new Date("2026-03-10T00:00:00Z") });
  const params = new URL(url).searchParams;
  const expires = params.get("expires");
  const signature = params.get("signature");

  // A tampered signature is rejected.
  assert.equal(verifyPrivateObjectSignature({ key: "qc/front.jpg", expires, signature: "forged", secret }), false);
  // A valid one within the window passes.
  assert.equal(verifyPrivateObjectSignature({ key: "qc/front.jpg", expires, signature, secret, now: new Date("2026-03-10T00:05:00Z") }), true);
  // Past expiry it fails.
  assert.equal(verifyPrivateObjectSignature({ key: "qc/front.jpg", expires, signature, secret, now: new Date("2026-03-10T01:00:00Z") }), false);
  // A different key with the same signature fails (no cross-object reuse / enumeration).
  assert.equal(verifyPrivateObjectSignature({ key: "identity/passport.jpg", expires, signature, secret }), false);
});

// ---- secret leakage ----
test("secrets and connection strings never leak into logs or error messages", () => {
  const safe = redactLogFields({ db_password: "hunter2", api_key: "sk-123", note: "ok" });
  assert.equal(safe.db_password, "[REDACTED]");
  assert.equal(safe.api_key, "[REDACTED]");
  const msg = publicErrorMessage(new Error("connect postgres://user:pass@host/db failed"));
  assert.ok(!msg.includes("pass"));
  assert.match(msg, /\[REDACTED\]/);
});
