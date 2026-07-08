import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";

function createTestServer(options = {}) {
  const logs = [];
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: options.logLevel || "info",
    READY_REQUIRES_DATABASE: "true",
    READY_REQUIRES_REDIS: "true"
  });
  const app = createApp({
    env,
    logger: {
      info: (line) => logs.push(line),
      error: (line) => logs.push(line)
    },
    services: options.services
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl, logs };
}

test("health endpoint stays alive without external dependencies", async () => {
  const { server, baseUrl } = createTestServer({
    logLevel: "silent",
    services: {
      checkDatabase: async () => {
        throw new Error("should not be called");
      },
      checkRedis: async () => {
        throw new Error("should not be called");
      }
    }
  });

  try {
    const response = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": "test-health" } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(response.headers.get("x-request-id"), "test-health");
  } finally {
    server.close();
  }
});

test("ready endpoint returns standard 503 when dependencies fail", async () => {
  const { server, baseUrl } = createTestServer({
    logLevel: "silent",
    services: {
      checkDatabase: async () => ({ name: "postgres", ok: false, reason: "DATABASE_URL not configured" }),
      checkRedis: async () => ({ name: "redis", ok: false, reason: "REDIS_URL not configured" })
    }
  });

  try {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "SERVICE_UNAVAILABLE");
    assert.equal(body.error.details.checks.length, 2);
  } finally {
    server.close();
  }
});

test("not found uses standard error envelope", async () => {
  const { server, baseUrl } = createTestServer({ logLevel: "silent" });

  try {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.ok(body.error.request_id);
  } finally {
    server.close();
  }
});

test("request logger records path only and avoids sensitive body/header data", async () => {
  const { server, baseUrl, logs } = createTestServer({
    services: {
      checkDatabase: async () => ({ name: "postgres", ok: true }),
      checkRedis: async () => ({ name: "redis", ok: true })
    }
  });

  try {
    await fetch(`${baseUrl}/health?token=secret`, {
      headers: {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json"
      },
      method: "POST",
      body: JSON.stringify({ password: "secret" })
    });

    const joined = logs.join("\n");
    assert.match(joined, /"path":"\/health"/);
    assert.doesNotMatch(joined, /secret-token/);
    assert.doesNotMatch(joined, /password/);
    assert.doesNotMatch(joined, /token=secret/);
  } finally {
    server.close();
  }
});

test("CORS allows configured local frontend origin and preflight", async () => {
  const { server, baseUrl } = createTestServer({ logLevel: "silent" });

  try {
    const response = await fetch(`${baseUrl}/links`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:8080",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:8080");
    assert.match(response.headers.get("access-control-allow-headers"), /authorization/);
  } finally {
    server.close();
  }
});
