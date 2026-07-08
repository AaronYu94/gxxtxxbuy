import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/auth/auth-service.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { errorHandler, notFoundHandler } from "../src/middleware/error-handler.js";
import { requireAdmin, requirePermission } from "../src/middleware/auth.js";
import { requestLogger } from "../src/middleware/request-logger.js";
import { hashPassword, verifyPassword } from "../src/security/password.js";
import { createAuditLogger } from "../src/audit/audit-log.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";

function createAuthTestApp(repository = new MemoryAuthRepository()) {
  const auditRepository = new MemoryAuditRepository();
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false"
  });
  const app = createApp({
    env,
    repositories: {
      auth: repository,
      audit: auditRepository
    }
  });
  const server = app.listen(0);
  return {
    app,
    repository,
    auditRepository,
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function postJson(baseUrl, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null
  };
}

test("password hash verifies correct password and rejects wrong password", async () => {
  const hash = await hashPassword("CorrectHorse123");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("CorrectHorse123", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("user register, /me, refresh rotation, and logout are enforced", async () => {
  const { server, baseUrl, auditRepository } = createAuthTestApp();
  try {
    const register = await postJson(baseUrl, "/auth/register", {
      email: "Buyer@Example.com",
      password: "CorrectHorse123",
      display_name: "Buyer"
    });
    assert.equal(register.response.status, 201);
    assert.equal(register.body.user.email, "Buyer@Example.com");
    assert.equal(register.body.user.display_name, "Buyer");
    assert.equal(register.body.user.password_hash, undefined);
    assert.ok(register.body.session.access_token);
    assert.ok(register.body.session.refresh_token);

    const duplicate = await postJson(baseUrl, "/auth/register", {
      email: "buyer@example.com",
      password: "CorrectHorse123"
    });
    assert.equal(duplicate.response.status, 409);

    const me = await fetch(`${baseUrl}/me`, {
      headers: {
        authorization: `Bearer ${register.body.session.access_token}`
      }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, "Buyer@Example.com");

    const refresh = await postJson(baseUrl, "/auth/refresh", {
      refresh_token: register.body.session.refresh_token
    });
    assert.equal(refresh.response.status, 200);
    assert.notEqual(refresh.body.session.access_token, register.body.session.access_token);

    const staleRefresh = await postJson(baseUrl, "/auth/refresh", {
      refresh_token: register.body.session.refresh_token
    });
    assert.equal(staleRefresh.response.status, 401);

    const logout = await postJson(baseUrl, "/auth/logout", {}, refresh.body.session.access_token);
    assert.equal(logout.response.status, 204);

    const afterLogout = await fetch(`${baseUrl}/me`, {
      headers: {
        authorization: `Bearer ${refresh.body.session.access_token}`
      }
    });
    assert.equal(afterLogout.status, 401);
    assert.ok(auditRepository.logs.some((log) => log.action === "auth.register"));
  } finally {
    server.close();
  }
});

test("login responses are generic and admin/user identities cannot be swapped", async () => {
  const repository = new MemoryAuthRepository();
  const admin = await repository.createAdminUser({
    email: "ops@example.com",
    emailNormalized: normalizeEmail("ops@example.com"),
    passwordHash: await hashPassword("AdminPass123"),
    displayName: "Ops",
    roles: ["operations"],
    permissions: ["ops:policy:write"]
  });
  assert.ok(admin.id);

  const { server, baseUrl } = createAuthTestApp(repository);
  try {
    await postJson(baseUrl, "/auth/register", {
      email: "buyer@example.com",
      password: "BuyerPass123"
    });

    const wrong = await postJson(baseUrl, "/auth/login", {
      email: "buyer@example.com",
      password: "wrong-password"
    });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.body.error.message, "Invalid email or password.");

    const userOnAdminRoute = await postJson(baseUrl, "/admin/auth/login", {
      email: "buyer@example.com",
      password: "BuyerPass123"
    });
    assert.equal(userOnAdminRoute.response.status, 401);

    const adminOnUserRoute = await postJson(baseUrl, "/auth/login", {
      email: "ops@example.com",
      password: "AdminPass123"
    });
    assert.equal(adminOnUserRoute.response.status, 401);

    const adminLogin = await postJson(baseUrl, "/admin/auth/login", {
      email: "ops@example.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin.response.status, 200);
    assert.deepEqual(adminLogin.body.roles, ["operations"]);
    assert.deepEqual(adminLogin.body.permissions, ["ops:policy:write"]);
    assert.equal(adminLogin.body.admin_user.password_hash, undefined);

    const adminMe = await fetch(`${baseUrl}/admin/me`, {
      headers: {
        authorization: `Bearer ${adminLogin.body.session.access_token}`
      }
    });
    assert.equal(adminMe.status, 200);
    assert.deepEqual((await adminMe.json()).permissions, ["ops:policy:write"]);
  } finally {
    server.close();
  }
});

test("RBAC middleware returns 401, 403, and allows matching permissions", async () => {
  const repository = new MemoryAuthRepository();
  await repository.createAdminUser({
    email: "buyer@example.com",
    emailNormalized: "buyer@example.com",
    passwordHash: await hashPassword("AdminPass123"),
    roles: ["support"],
    permissions: ["orders:read"]
  });
  const authService = createAuthService({ repository });
  const app = express();
  app.use(express.json());
  app.use(requestLogger({ logLevel: "silent" }));
  app.get("/protected", requireAdmin(authService), requirePermission("orders:read"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/denied", requireAdmin(authService), requirePermission("orders:write"), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(notFoundHandler);
  app.use(errorHandler({ logger: { info() {}, error() {} } }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const noToken = await fetch(`${baseUrl}/protected`);
    assert.equal(noToken.status, 401);

    const login = await authService.loginAdmin({
      email: "buyer@example.com",
      password: "AdminPass123"
    });

    const allowed = await fetch(`${baseUrl}/protected`, {
      headers: {
        authorization: `Bearer ${login.session.access_token}`
      }
    });
    assert.equal(allowed.status, 200);

    const denied = await fetch(`${baseUrl}/denied`, {
      headers: {
        authorization: `Bearer ${login.session.access_token}`
      }
    });
    assert.equal(denied.status, 403);
  } finally {
    server.close();
  }
});
