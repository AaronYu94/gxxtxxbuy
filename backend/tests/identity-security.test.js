import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createAuthService } from "../src/auth/auth-service.js";
import { normalizeEmail } from "../src/auth/input.js";
import { createAuditLogger } from "../src/audit/audit-log.js";
import { createDataScopeContext, DATA_SCOPES, assertScopeCannotExpand } from "../src/rbac/data-scope.js";
import { ROLE_DEFINITIONS } from "../src/rbac/permissions.js";
import { hashPassword } from "../src/security/password.js";
import { createSessionPayload } from "../src/auth/session.js";
import { decryptTotpSecret, encryptTotpSecret, generateTotpCode, generateTotpSecret } from "../src/security/totp.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";

test("V2 defines exactly nine stable roles and restrictive server data scopes", () => {
  assert.deepEqual(ROLE_DEFINITIONS.map((role) => role.code), [
    "super_admin", "procurement_agent", "procurement_lead", "support_agent",
    "warehouse_operator", "warehouse_lead", "finance_operator", "campaign_operator", "referral_operator"
  ]);
  assert.throws(
    () => createDataScopeContext({ roles: ["support_agent"], adminUser: { id: "a1" }, query: {} }),
    /exact search criterion/
  );
  const exact = createDataScopeContext({
    roles: ["support_agent"], adminUser: { id: "a1" }, query: { email: "buyer@example.com", admin_user_id: "someone-else" }
  });
  assert.equal(exact.scope, DATA_SCOPES.SEARCH);
  assert.deepEqual(exact.exactSearch, { email: "buyer@example.com" });
  assert.throws(() => assertScopeCannotExpand(exact, { admin_user_id: "someone-else" }), /cannot expand/);
  assert.throws(() => createDataScopeContext({ roles: ["support_agent", "warehouse_operator"], adminUser: {} }), /Exactly one/);
});

test("TOTP secrets are encrypted at rest and counters reject replay", () => {
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, "test-encryption-key");
  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptTotpSecret(encrypted, "test-encryption-key"), secret);
  const at = new Date("2026-07-09T12:00:00.000Z");
  assert.match(generateTotpCode(secret, at), /^\d{6}$/);
});

test("failed logins create a 24-hour safety lock without changing manual risk status", async () => {
  let now = new Date("2026-07-09T12:00:00.000Z");
  const repository = new MemoryAuthRepository();
  const user = await repository.createUser({
    email: "locked@example.com", emailNormalized: "locked@example.com",
    passwordHash: await hashPassword("CorrectHorse123"), emailVerifiedAt: now.toISOString()
  });
  const service = createAuthService({
    repository, clock: () => now,
    env: { authLoginFailureLimit: 2, authLoginFailureWindowSeconds: 900, authSecurityLockSeconds: 86400 }
  });
  await assert.rejects(service.loginUser({ email: user.email, password: "wrong" }), /Invalid email or password/);
  await assert.rejects(service.loginUser({ email: user.email, password: "wrong" }), /Invalid email or password/);
  const locked = await repository.findUserById(user.id);
  assert.equal(locked.status, "normal");
  assert.equal(locked.securityLockedUntil, "2026-07-10T12:00:00.000Z");
  await assert.rejects(service.loginUser({ email: user.email, password: "CorrectHorse123" }), /temporarily locked/);
  now = new Date("2026-07-10T12:00:01.000Z");
  const login = await service.loginUser({ email: user.email, password: "CorrectHorse123" });
  assert.equal(login.device_verification_required, true);
});

test("email or password security changes revoke device trust and every user session", async () => {
  const repository = new MemoryAuthRepository();
  const user = await repository.createUser({
    email: "trust@example.com", emailNormalized: "trust@example.com",
    passwordHash: await hashPassword("CorrectHorse123"), emailVerifiedAt: new Date().toISOString()
  });
  await repository.upsertUserDevice({ userId: user.id, deviceHash: "irreversible-hash", lastSeenAt: new Date().toISOString() });
  await repository.trustUserDevice(user.id, "irreversible-hash", new Date().toISOString());
  const sessionPayload = createSessionPayload("user", {}, new Date());
  const session = await repository.createSession({ actorType: "user", userId: user.id, ...sessionPayload });
  const service = createAuthService({ repository });
  await service.invalidateUserTrust(user.id);
  assert.ok((await repository.findUserDevice(user.id, "irreversible-hash")).trustRevokedAt);
  assert.ok(repository.sessions.get(session.id).revokedAt);
});

test("employee number is unique, role assignment is single, and disabling revokes sessions", async () => {
  const repository = new MemoryAuthRepository();
  const admin = await repository.createAdminUser({
    email: "employee@example.com", emailNormalized: normalizeEmail("employee@example.com"),
    employeeNo: "GB-0099", passwordHash: await hashPassword("AdminPass123")
  });
  await assert.rejects(repository.createAdminUser({
    email: "other@example.com", emailNormalized: "other@example.com", employeeNo: "GB-0099",
    passwordHash: await hashPassword("AdminPass123")
  }), /duplicate employee number/);
  assert.equal(await repository.assignAdminRole(admin.id, "support_agent"), true);
  assert.equal(await repository.assignAdminRole(admin.id, "warehouse_operator"), false);
  const payload = createSessionPayload("admin", {}, new Date(), { mfaVerifiedAt: new Date().toISOString() });
  const session = await repository.createSession({ actorType: "admin", adminUserId: admin.id, ...payload });
  await repository.disableAdminUser(admin.id);
  assert.equal((await repository.findAdminById(admin.id)).status, "disabled");
  assert.ok(repository.sessions.get(session.id).revokedAt);
});

test("fresh high-risk proof is action-bound, one-time, reasoned, and audit fail-closed", async () => {
  let now = new Date("2026-07-09T12:00:00.000Z");
  const repository = new MemoryAuthRepository();
  const auditRepository = new MemoryAuditRepository();
  const service = createAuthService({
    repository,
    auditLogger: createAuditLogger({ repository: auditRepository, logger: { error() {} } }),
    clock: () => now,
    env: { authTotpEncryptionSecret: "test-totp-key", authExposeVerificationToken: true }
  });
  await repository.createAdminUser({
    email: "root@example.com", emailNormalized: "root@example.com", employeeNo: "GB-0001",
    passwordHash: await hashPassword("AdminPass123"), roles: ["super_admin"], permissions: ["*"]
  });
  const challenge = await service.loginAdmin({ email: "root@example.com", password: "AdminPass123" });
  const setup = await service.beginAdminTotpSetup({ challenge_token: challenge.challenge_token });
  const login = await service.confirmAdminTotpSetup({
    challenge_token: challenge.challenge_token, code: generateTotpCode(setup.secret, now)
  });
  now = new Date(now.getTime() + 31000);
  const auth = await service.authenticateAdmin(login.session.access_token);
  const proof = await service.createAdminReauth(auth, {
    action: "config.write", reason: "Rotate restricted shipping policy", code: generateTotpCode(setup.secret, now)
  });
  await service.consumeAdminReauth(proof.reauth_token, auth, "config.write");
  await assert.rejects(service.consumeAdminReauth(proof.reauth_token, auth, "config.write"), /required|already/);
  assert.equal(auditRepository.logs.at(-1).metadata.reauth_token, "[REDACTED]");

  now = new Date(now.getTime() + 31000);
  auditRepository.fail = true;
  await assert.rejects(service.createAdminReauth(auth, {
    action: "admin.user.disable", reason: "Confirmed offboarding", code: generateTotpCode(setup.secret, now)
  }), /audit insert failed/);
  assert.equal(repository.reauthChallenges.size, 1);
});

test("migration makes audit rows immutable and keeps all one-time security models", () => {
  const sql = readFileSync(new URL("../migrations/000014_identity_permissions_audit_v2.sql", import.meta.url), "utf8");
  for (const required of [
    "email_verification_tokens", "user_devices", "login_attempts", "admin_auth_challenges",
    "admin_totp_recovery_codes", "admin_reauth_challenges", "admin_user_roles_one_role_unique",
    "audit_logs_prevent_update", "audit_logs_prevent_delete"
  ]) assert.match(sql, new RegExp(required));
});
