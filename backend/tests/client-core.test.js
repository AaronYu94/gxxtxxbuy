import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { identifyPlatform, normalizeProductUrl } from "../src/core/link-platform.js";
import { MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";

function createClientCoreTestApp(options = {}) {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false"
  });
  const repositories = {
    auth: options.authRepository || new MemoryAuthRepository(),
    audit: options.auditRepository || new MemoryAuditRepository(),
    core: options.coreRepository || new MemoryCoreRepository(options.coreOptions)
  };
  const queue = options.queue || {
    async enqueue(_queueName, payload) {
      return { id: "job_1", payload };
    }
  };
  const app = createApp({ env, repositories, queue });
  const server = app.listen(0);
  return {
    server,
    repositories,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
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
  return {
    response,
    body: text ? JSON.parse(text) : null
  };
}

async function register(baseUrl, email = "buyer@example.com") {
  return (await registerVerifiedUser(baseUrl, email)).token;
}

test("product URL platform recognition covers supported marketplaces", () => {
  assert.equal(identifyPlatform("item.taobao.com"), "Taobao");
  assert.equal(identifyPlatform("detail.1688.com"), "1688");
  assert.equal(identifyPlatform("shop.weidian.com"), "Weidian");
  assert.equal(identifyPlatform("abc.x.yupoo.com"), "Yupoo");
  assert.equal(identifyPlatform("example.com"), "Other");
  assert.throws(() => normalizeProductUrl(""), /Product URL is required/);
  assert.equal(normalizeProductUrl("item.taobao.com/item.htm?id=1#frag").platform, "Taobao");
});

test("links API validates input, deduplicates, queues parse, and enforces ownership", async () => {
  const queueCalls = [];
  const { server, baseUrl } = createClientCoreTestApp({
    queue: {
      async enqueue(queueName, payload) {
        queueCalls.push({ queueName, payload });
        return { id: "parse_job_1" };
      }
    }
  });

  try {
    const token = await register(baseUrl, "buyer@example.com");
    const otherToken = await register(baseUrl, "other@example.com");

    const unauthenticated = await requestJson(baseUrl, "/links", {
      method: "POST",
      body: { url: "https://item.taobao.com/item.htm?id=1" }
    });
    assert.equal(unauthenticated.response.status, 401);

    const invalid = await requestJson(baseUrl, "/links", {
      method: "POST",
      token,
      body: { url: "" }
    });
    assert.equal(invalid.response.status, 400);

    const saved = await requestJson(baseUrl, "/links", {
      method: "POST",
      token,
      body: { url: "https://item.taobao.com/item.htm?id=1" }
    });
    assert.equal(saved.response.status, 201);
    assert.equal(saved.body.link.platform, "Taobao");

    const duplicate = await requestJson(baseUrl, "/links", {
      method: "POST",
      token,
      body: { url: "https://item.taobao.com/item.htm?id=1" }
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.existing, true);

    const parse = await requestJson(baseUrl, `/links/${saved.body.link.id}/parse`, {
      method: "POST",
      token
    });
    assert.equal(parse.response.status, 202);
    assert.equal(parse.body.link.status, "parsing");
    assert.equal(queueCalls[0].queueName, "links:parse");

    const otherPatch = await requestJson(baseUrl, `/links/${saved.body.link.id}`, {
      method: "PATCH",
      token: otherToken,
      body: { title: "Not mine" }
    });
    assert.equal(otherPatch.response.status, 404);
  } finally {
    server.close();
  }
});

test("parse endpoint keeps link when queue fails and marks failure", async () => {
  const { server, baseUrl } = createClientCoreTestApp({
    queue: {
      async enqueue() {
        throw new Error("redis unavailable");
      }
    }
  });

  try {
    const token = await register(baseUrl);
    const saved = await requestJson(baseUrl, "/links", {
      method: "POST",
      token,
      body: { url: "https://detail.1688.com/offer/1.html" }
    });
    const parse = await requestJson(baseUrl, `/links/${saved.body.link.id}/parse`, {
      method: "POST",
      token
    });
    assert.equal(parse.response.status, 202);
    assert.equal(parse.body.link.status, "failed");
    assert.equal(parse.body.link.parse_error, "redis unavailable");

    const links = await requestJson(baseUrl, "/links", { token });
    assert.equal(links.body.links.length, 1);
    assert.equal(links.body.links[0].status, "failed");
  } finally {
    server.close();
  }
});

test("haul and order APIs are user scoped, duplicate-safe, and record status history", async () => {
  const { server, baseUrl } = createClientCoreTestApp();

  try {
    const token = await register(baseUrl, "buyer@example.com");
    const otherToken = await register(baseUrl, "other@example.com");
    const saved = await requestJson(baseUrl, "/links", {
      method: "POST",
      token,
      body: { url: "https://shop.weidian.com/item.html?itemID=1" }
    });

    const patched = await requestJson(baseUrl, `/links/${saved.body.link.id}`, {
      method: "PATCH",
      token,
      body: {
        title: "Sneaker",
        spec: "Black / 42",
        price: 38.5,
        quantity: 2,
        note: "Box optional"
      }
    });
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.link.status, "parsed");

    const added = await requestJson(baseUrl, `/links/${saved.body.link.id}/add-to-haul`, {
      method: "POST",
      token
    });
    assert.equal(added.response.status, 201);
    assert.equal(added.body.item.price, 38.5);

    const duplicateAdd = await requestJson(baseUrl, `/links/${saved.body.link.id}/add-to-haul`, {
      method: "POST",
      token
    });
    assert.equal(duplicateAdd.response.status, 200);
    assert.equal(duplicateAdd.body.existing, true);

    const waiting = await requestJson(baseUrl, "/haul-items?status=waiting_purchase", { token });
    assert.equal(waiting.response.status, 200);
    assert.equal(waiting.body.items.length, 1);

    const order = await requestJson(baseUrl, "/purchase-orders", {
      method: "POST",
      token,
      body: { haul_item_id: added.body.item.id }
    });
    assert.equal(order.response.status, 201);
    assert.equal(order.body.order.status, "submitted");
    assert.equal(order.body.order.history[0].to_status, "submitted");
    assert.equal(order.body.order.internal_notes, undefined);

    const duplicateOrder = await requestJson(baseUrl, "/purchase-orders", {
      method: "POST",
      token,
      body: { haul_item_id: added.body.item.id }
    });
    assert.equal(duplicateOrder.response.status, 200);
    assert.equal(duplicateOrder.body.existing, true);

    const orders = await requestJson(baseUrl, "/orders", { token });
    assert.equal(orders.body.orders.length, 1);

    const detail = await requestJson(baseUrl, `/orders/${order.body.order.id}`, { token });
    assert.equal(detail.response.status, 200);

    const otherDetail = await requestJson(baseUrl, `/orders/${order.body.order.id}`, { token: otherToken });
    assert.equal(otherDetail.response.status, 404);
  } finally {
    server.close();
  }
});

test("policies API returns published policies and safe fallback", async () => {
  const publishedPolicy = {
    id: "policy-1",
    policyType: "qc",
    title: "QC",
    body: "Published QC copy",
    status: "published",
    version: 2,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const draftPolicy = {
    id: "policy-2",
    policyType: "hidden",
    title: "Hidden",
    body: "Draft copy",
    status: "draft",
    version: 1
  };

  const { server, baseUrl } = createClientCoreTestApp({
    coreOptions: { policies: [publishedPolicy, draftPolicy] }
  });

  try {
    const result = await requestJson(baseUrl, "/policies");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.policies.length, 1);
    assert.equal(result.body.policies[0].body, "Published QC copy");
  } finally {
    server.close();
  }

  const fallbackApp = createClientCoreTestApp();
  try {
    const fallback = await requestJson(fallbackApp.baseUrl, "/policies");
    assert.equal(fallback.response.status, 200);
    assert.ok(fallback.body.policies.length >= 3);
    assert.ok(fallback.body.policies.every((policy) => policy.policy_type));
  } finally {
    fallbackApp.server.close();
  }

  const failingPolicyApp = createClientCoreTestApp({
    coreRepository: {
      async listPublishedPolicies() {
        throw new Error("database unavailable");
      }
    }
  });
  try {
    const fallback = await requestJson(failingPolicyApp.baseUrl, "/policies");
    assert.equal(fallback.response.status, 200);
    assert.ok(fallback.body.policies.length >= 3);
  } finally {
    failingPolicyApp.server.close();
  }
});
