import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { createRiskService } from "../src/risk/risk-service.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryRiskRepository } from "./helpers/memory-risk-repository.js";

function createRiskTestApp() {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    STORAGE_DRIVER: "memory"
  });
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    risk: new MemoryRiskRepository()
  };
  const app = createApp({ env, repositories });
  const server = app.listen(0);
  return { server, repositories, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function requestJson(baseUrl, path, { method = "GET", token = "", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function createAdmin(repository, { email, roles = [], permissions = [] }) {
  await repository.createAdminUser({
    email,
    emailNormalized: normalizeEmail(email),
    passwordHash: await hashPassword("AdminPass123"),
    roles,
    permissions
  });
}

async function loginAdmin(baseUrl, email) {
  const result = await requestJson(baseUrl, "/admin/auth/login", {
    method: "POST",
    body: { email, password: "AdminPass123" }
  });
  assert.equal(result.response.status, 200);
  return result.body.session.access_token;
}

test("risk cases are permission gated with legal status transitions", async () => {
  const { server, baseUrl, repositories } = createRiskTestApp();
  try {
    await createAdmin(repositories.auth, { email: "risk@example.com", roles: ["risk"], permissions: ["risk:case:write"] });
    await createAdmin(repositories.auth, { email: "proc@example.com", roles: ["procurement"], permissions: ["orders:read", "orders:write"] });
    const riskToken = await loginAdmin(baseUrl, "risk@example.com");
    const procToken = await loginAdmin(baseUrl, "proc@example.com");

    const denied = await requestJson(baseUrl, "/admin/risk-cases", { method: "POST", token: procToken, body: { risk_type: "fraud" } });
    assert.equal(denied.response.status, 403);

    const missingType = await requestJson(baseUrl, "/admin/risk-cases", { method: "POST", token: riskToken, body: {} });
    assert.equal(missingType.response.status, 400);

    const created = await requestJson(baseUrl, "/admin/risk-cases", {
      method: "POST",
      token: riskToken,
      body: { risk_type: "chargeback", severity: "high", reason: "multiple disputes" }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.case.status, "open");
    const caseId = created.body.case.id;

    // Illegal transition: open -> resolved is legal, but resolved -> open is not.
    const resolved = await requestJson(baseUrl, `/admin/risk-cases/${caseId}`, {
      method: "PATCH",
      token: riskToken,
      body: { status: "resolved" }
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.body.case.status, "resolved");
    assert.ok(resolved.body.case.resolved_at);

    const illegal = await requestJson(baseUrl, `/admin/risk-cases/${caseId}`, {
      method: "PATCH",
      token: riskToken,
      body: { status: "open" }
    });
    assert.equal(illegal.response.status, 400);

    const list = await requestJson(baseUrl, "/admin/risk-cases?status=resolved", { token: riskToken });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.cases.length, 1);
    assert.equal(list.body.pagination.total, 1);
  } finally {
    server.close();
  }
});

test("coupon abuse scan is disabled by default, threshold configurable, and idempotent", async () => {
  const repository = new MemoryRiskRepository();
  const disabledEnv = { riskCouponAbuseEnabled: false, riskCouponAbuseThreshold: 5 };
  const disabled = createRiskService({ repository, env: disabledEnv });
  const off = await disabled.scanCouponAbuse([{ userId: "u1", redeemedCount: 9 }]);
  assert.equal(off.enabled, false);
  assert.equal(off.opened, 0);

  const enabledEnv = { riskCouponAbuseEnabled: true, riskCouponAbuseThreshold: 5 };
  const service = createRiskService({ repository, env: enabledEnv });
  const candidates = [
    { userId: "u1", redeemedCount: 9 },
    { userId: "u2", redeemedCount: 2 }
  ];
  const first = await service.scanCouponAbuse(candidates);
  assert.equal(first.enabled, true);
  assert.equal(first.opened, 1);
  assert.equal(first.cases[0].subject_user_id, "u1");

  // Re-running does not open a second case for the same subject.
  const second = await service.scanCouponAbuse(candidates);
  assert.equal(second.opened, 0);
});
