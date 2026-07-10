import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { loginAdminWithTotp, MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryCountryRepository } from "./helpers/memory-country-repository.js";

function createCountryTestApp() {
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
    country: new MemoryCountryRepository()
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
  return (await loginAdminWithTotp(baseUrl, email)).session.access_token;
}

test("country shipping hub returns only published content and marks expired versions", async () => {
  const { server, baseUrl, repositories } = createCountryTestApp();
  try {
    await createAdmin(repositories.auth, { email: "ops@example.com", roles: ["campaign_operator"], permissions: ["ops:policy:write"] });
    await createAdmin(repositories.auth, { email: "proc@example.com", roles: ["procurement_agent"], permissions: ["orders:read"] });
    const opsToken = await loginAdmin(baseUrl, "ops@example.com");
    const procToken = await loginAdmin(baseUrl, "proc@example.com");

    // Draft is not visible on the public endpoint.
    await requestJson(baseUrl, "/admin/country-shipping", {
      method: "PUT",
      token: opsToken,
      body: { country: "United States", version: 1, title: "US v1", status: "draft" }
    });
    const draftPublic = await requestJson(baseUrl, "/country-shipping/United States");
    assert.equal(draftPublic.response.status, 404);

    // Non-policy admins cannot manage content.
    const denied = await requestJson(baseUrl, "/admin/country-shipping", {
      method: "PUT",
      token: procToken,
      body: { country: "United States", version: 2, status: "published" }
    });
    assert.equal(denied.response.status, 403);

    // Publish a non-expired version.
    const publish = await requestJson(baseUrl, "/admin/country-shipping", {
      method: "PUT",
      token: opsToken,
      body: {
        country: "United States",
        version: 2,
        title: "US v2",
        summary: "Fast air lines",
        status: "published",
        expires_at: "2999-01-01T00:00:00.000Z"
      }
    });
    assert.equal(publish.response.status, 200);

    const fresh = await requestJson(baseUrl, "/country-shipping/United States");
    assert.equal(fresh.response.status, 200);
    assert.equal(fresh.body.country.version, 2);
    assert.equal(fresh.body.expired, false);

    // Publish a higher, already-expired version; it becomes the latest and is flagged expired.
    await requestJson(baseUrl, "/admin/country-shipping", {
      method: "PUT",
      token: opsToken,
      body: {
        country: "United States",
        version: 3,
        title: "US v3",
        status: "published",
        expires_at: "2000-01-01T00:00:00.000Z"
      }
    });
    const expired = await requestJson(baseUrl, "/country-shipping/United States");
    assert.equal(expired.response.status, 200);
    assert.equal(expired.body.country.version, 3);
    assert.equal(expired.body.expired, true);
  } finally {
    server.close();
  }
});
