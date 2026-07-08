import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryCreatorRepository } from "./helpers/memory-creator-repository.js";

function createCreatorTestApp() {
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
    creator: new MemoryCreatorRepository()
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

async function registerUser(baseUrl, email) {
  const result = await requestJson(baseUrl, "/auth/register", {
    method: "POST",
    body: { email, password: "CorrectHorse123" }
  });
  assert.equal(result.response.status, 201);
  return { token: result.body.session.access_token, userId: result.body.user.id };
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

test("creator touch attribution is public, validated, idempotent, and dashboard is aggregate-only", async () => {
  const { server, baseUrl, repositories } = createCreatorTestApp();
  try {
    await createAdmin(repositories.auth, { email: "ops@example.com", roles: ["operations"], permissions: ["ops:policy:write"] });
    const opsToken = await loginAdmin(baseUrl, "ops@example.com");
    const buyer = await registerUser(baseUrl, "buyer@example.com");

    // Only operations can register a creator, and the creator is linked to a user.
    const deniedCreate = await requestJson(baseUrl, "/admin/creators", {
      method: "POST",
      token: buyer.token,
      body: { code: "GOAT", user_id: buyer.userId }
    });
    assert.equal(deniedCreate.response.status, 401); // client token is not an admin token

    const created = await requestJson(baseUrl, "/admin/creators", {
      method: "POST",
      token: opsToken,
      body: { code: "goat", display_name: "Goat Creator", user_id: buyer.userId }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.creator.code, "GOAT");

    const campaign = await requestJson(baseUrl, `/admin/creators/${created.body.creator.id}/campaigns`, {
      method: "POST",
      token: opsToken,
      body: { code: "spring", name: "Spring Haul" }
    });
    assert.equal(campaign.response.status, 201);
    assert.equal(campaign.body.campaign.code, "SPRING");

    // Missing code fails.
    const noCode = await requestJson(baseUrl, "/creator-campaign/touch", { method: "POST", body: {} });
    assert.equal(noCode.response.status, 400);

    // Unknown creator fails.
    const unknown = await requestJson(baseUrl, "/creator-campaign/touch", {
      method: "POST",
      body: { campaign_code: "NOPE", session_id: "sess-1" }
    });
    assert.equal(unknown.response.status, 404);

    // Anonymous visit records a touch.
    const visit = await requestJson(baseUrl, "/creator-campaign/touch", {
      method: "POST",
      body: { campaign_code: "spring", session_id: "sess-1" }
    });
    assert.equal(visit.response.status, 201);
    assert.equal(visit.body.attribution.touch_type, "visit");
    // Response must not leak session id or user id.
    assert.equal(visit.body.attribution.session_id, undefined);
    assert.equal(visit.body.attribution.user_id, undefined);

    // Repeating the same touch is idempotent (no double counting).
    await requestJson(baseUrl, "/creator-campaign/touch", {
      method: "POST",
      body: { campaign_code: "spring", session_id: "sess-1" }
    });

    // A signup touch carrying the buyer token attributes the user.
    const signup = await requestJson(baseUrl, "/creator-campaign/touch", {
      method: "POST",
      token: buyer.token,
      body: { campaign_code: "spring", session_id: "sess-1", touch_type: "signup" }
    });
    assert.equal(signup.response.status, 201);

    // A non-creator user cannot open the dashboard.
    const outsider = await registerUser(baseUrl, "outsider@example.com");
    const denied = await requestJson(baseUrl, "/creator/dashboard", { token: outsider.token });
    assert.equal(denied.response.status, 403);

    // The linked creator sees only aggregate counts and their campaigns.
    const dashboard = await requestJson(baseUrl, "/creator/dashboard", { token: buyer.token });
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.stats.visits, 1);
    assert.equal(dashboard.body.stats.signups, 1);
    assert.equal(dashboard.body.campaigns.length, 1);
    // No buyer PII surface on the dashboard.
    assert.equal(JSON.stringify(dashboard.body).includes("outsider@example.com"), false);
  } finally {
    server.close();
  }
});
