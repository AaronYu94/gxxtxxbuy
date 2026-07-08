import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryContentRepository } from "./helpers/memory-content-repository.js";

function createContentTestApp() {
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
    content: new MemoryContentRepository()
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
  return result.body.session.access_token;
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

test("haul stories default to pending private, moderation is permission gated, and authors can withdraw", async () => {
  const { server, baseUrl, repositories } = createContentTestApp();
  try {
    const author = await registerUser(baseUrl, "author@example.com");
    await createAdmin(repositories.auth, { email: "mod@example.com", roles: ["support"], permissions: ["content:review:write"] });
    await createAdmin(repositories.auth, { email: "proc@example.com", roles: ["procurement"], permissions: ["orders:read", "orders:write"] });
    const modToken = await loginAdmin(baseUrl, "mod@example.com");
    const procToken = await loginAdmin(baseUrl, "proc@example.com");

    // Missing title fails.
    const invalid = await requestJson(baseUrl, "/haul-stories", { method: "POST", token: author.token || author, body: {} });
    assert.equal(invalid.response.status, 400);

    // Create a story; even asking for public, it starts pending.
    const created = await requestJson(baseUrl, "/haul-stories", {
      method: "POST",
      token: author,
      body: { title: "My first haul", body: "Loved it", privacy_level: "public" }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.story.review_status, "pending");
    const storyId = created.body.story.id;

    // A non-review admin cannot see the queue.
    const deniedQueue = await requestJson(baseUrl, "/admin/content-review", { token: procToken });
    assert.equal(deniedQueue.response.status, 403);

    // Moderator sees the pending story.
    const queue = await requestJson(baseUrl, "/admin/content-review?status=pending", { token: modToken });
    assert.equal(queue.response.status, 200);
    assert.equal(queue.body.stories.length, 1);
    assert.equal(queue.body.pagination.total, 1);

    // Reject requires a reason.
    const noReason = await requestJson(baseUrl, `/admin/content-review/${storyId}/action`, {
      method: "POST",
      token: modToken,
      body: { action: "reject" }
    });
    assert.equal(noReason.response.status, 400);

    // Approve the story.
    const approved = await requestJson(baseUrl, `/admin/content-review/${storyId}/action`, {
      method: "POST",
      token: modToken,
      body: { action: "approve" }
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.story.review_status, "approved");

    // Author can withdraw their own story.
    const withdrawn = await requestJson(baseUrl, `/haul-stories/${storyId}/withdraw`, { method: "POST", token: author });
    assert.equal(withdrawn.response.status, 201);
    assert.equal(withdrawn.body.story.review_status, "withdrawn");

    // Withdrawn stories can no longer be actioned.
    const afterWithdraw = await requestJson(baseUrl, `/admin/content-review/${storyId}/action`, {
      method: "POST",
      token: modToken,
      body: { action: "hide", reason: "cleanup" }
    });
    assert.equal(afterWithdraw.response.status, 409);
  } finally {
    server.close();
  }
});
