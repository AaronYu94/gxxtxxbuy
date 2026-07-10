import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword, verifyPassword } from "../src/security/password.js";
import { generateTotpCode } from "../src/security/totp.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";

function createAuthTestApp(repository = new MemoryAuthRepository()) {
  const auditRepository = new MemoryAuditRepository();
  const env = parseEnv({
    NODE_ENV: "test", PORT: "3000", REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false", READY_REQUIRES_REDIS: "false",
    AUTH_VERIFICATION_RESEND_SECONDS: "1"
  });
  const app = createApp({ env, repositories: { auth: repository, audit: auditRepository } });
  const server = app.listen(0);
  return { repository, auditRepository, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function postJson(baseUrl, path, body, { token = "", deviceId = "test-device" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-device-id": deviceId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("password hash verifies correct password and rejects wrong password", async () => {
  const hash = await hashPassword("CorrectHorse123");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("CorrectHorse123", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("registration requires idempotent email verification before a trusted-device session", async () => {
  const { server, baseUrl, auditRepository } = createAuthTestApp();
  try {
    const registration = await postJson(baseUrl, "/auth/register", {
      email: "Buyer@Example.com", password: "CorrectHorse123", display_name: "Buyer"
    });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.body.verification_required, true);
    assert.equal(registration.body.session, undefined);
    assert.ok(registration.body.verification_token);

    const unverifiedLogin = await postJson(baseUrl, "/auth/login", {
      email: "buyer@example.com", password: "CorrectHorse123"
    });
    assert.equal(unverifiedLogin.response.status, 403);

    const verified = await postJson(baseUrl, "/auth/verify-email", { token: registration.body.verification_token });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.user.email_verified, true);
    const repeated = await postJson(baseUrl, "/auth/verify-email", { token: registration.body.verification_token });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.idempotent, true);

    const duplicate = await postJson(baseUrl, "/auth/register", {
      email: "buyer@example.com", password: "CorrectHorse123"
    });
    assert.equal(duplicate.response.status, 409);

    const login = await postJson(baseUrl, "/auth/login", {
      email: "buyer@example.com", password: "CorrectHorse123"
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.session.access_token);
    const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${login.body.session.access_token}` } });
    assert.equal(me.status, 200);

    const refresh = await postJson(baseUrl, "/auth/refresh", { refresh_token: login.body.session.refresh_token });
    assert.equal(refresh.response.status, 200);
    const stale = await postJson(baseUrl, "/auth/refresh", { refresh_token: login.body.session.refresh_token });
    assert.equal(stale.response.status, 401);
    const logout = await postJson(baseUrl, "/auth/logout", {}, { token: refresh.body.session.access_token });
    assert.equal(logout.response.status, 204);
    assert.ok(auditRepository.logs.some((log) => log.action === "auth.register"));
    assert.equal(auditRepository.logs.find((log) => log.action === "auth.register").metadata.verification_token, "[REDACTED]");
  } finally {
    server.close();
  }
});

test("new devices require a one-time email challenge", async () => {
  const { server, baseUrl } = createAuthTestApp();
  try {
    const registration = await postJson(baseUrl, "/auth/register", {
      email: "device@example.com", password: "CorrectHorse123"
    }, { deviceId: "device-a" });
    await postJson(baseUrl, "/auth/verify-email", { token: registration.body.verification_token }, { deviceId: "device-a" });

    const newDevice = await postJson(baseUrl, "/auth/login", {
      email: "device@example.com", password: "CorrectHorse123"
    }, { deviceId: "device-b" });
    assert.equal(newDevice.body.device_verification_required, true);
    assert.equal(newDevice.body.session, undefined);

    const completed = await postJson(baseUrl, "/auth/verify-device", {
      token: newDevice.body.verification_token
    }, { deviceId: "device-b" });
    assert.ok(completed.body.session.access_token);
    const replay = await postJson(baseUrl, "/auth/verify-device", {
      token: newDevice.body.verification_token
    }, { deviceId: "device-b" });
    assert.equal(replay.response.status, 409);
  } finally {
    server.close();
  }
});

test("admin password step never creates a session; TOTP setup gates RBAC and blocks replay", async () => {
  const repository = new MemoryAuthRepository();
  await repository.createAdminUser({
    email: "support@example.com", emailNormalized: normalizeEmail("support@example.com"),
    employeeNo: "GB-0001", passwordHash: await hashPassword("AdminPass123"),
    roles: ["support_agent"], permissions: ["orders:read"]
  });
  const { server, baseUrl } = createAuthTestApp(repository);
  try {
    const passwordStep = await postJson(baseUrl, "/admin/auth/login", {
      email: "support@example.com", password: "AdminPass123"
    });
    assert.equal(passwordStep.response.status, 200);
    assert.equal(passwordStep.body.setup_required, true);
    assert.equal(passwordStep.body.session, undefined);

    const setup = await postJson(baseUrl, "/admin/auth/totp/setup", {
      challenge_token: passwordStep.body.challenge_token
    });
    const code = generateTotpCode(setup.body.secret);
    const confirmed = await postJson(baseUrl, "/admin/auth/totp/confirm", {
      challenge_token: passwordStep.body.challenge_token, code
    });
    assert.ok(confirmed.body.session.access_token);
    assert.equal(confirmed.body.recovery_codes.length, 8);

    const me = await fetch(`${baseUrl}/admin/me`, {
      headers: { authorization: `Bearer ${confirmed.body.session.access_token}` }
    });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).roles, ["support_agent"]);
    const directUrl = await fetch(`${baseUrl}/admin/warehouse/items`, {
      headers: { authorization: `Bearer ${confirmed.body.session.access_token}` }
    });
    assert.equal(directUrl.status, 403);

    const secondPassword = await postJson(baseUrl, "/admin/auth/login", {
      email: "support@example.com", password: "AdminPass123"
    });
    const replay = await postJson(baseUrl, "/admin/auth/verify-totp", {
      challenge_token: secondPassword.body.challenge_token, code
    });
    assert.equal(replay.response.status, 401);
    const recovered = await postJson(baseUrl, "/admin/auth/verify-totp", {
      challenge_token: secondPassword.body.challenge_token,
      recovery_code: confirmed.body.recovery_codes[0]
    });
    assert.ok(recovered.body.session.access_token);
  } finally {
    server.close();
  }
});
