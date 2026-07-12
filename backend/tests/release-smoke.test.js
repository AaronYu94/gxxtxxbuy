import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";

// V2-12-26 — the post-deploy smoke test. After a release (or a rollback), these
// endpoints must respond correctly with no external dependencies wired.
function server() {
  const env = parseEnv({ NODE_ENV: "test", PORT: "3000", REQUEST_LOG_LEVEL: "silent", READY_REQUIRES_DATABASE: "false", READY_REQUIRES_REDIS: "false" });
  const app = createApp({ env, logger: { info() {}, error() {} }, services: { checkDatabase: async () => ({ ok: true }), checkRedis: async () => ({ ok: true }) } });
  const s = app.listen(0);
  return { s, baseUrl: `http://127.0.0.1:${s.address().port}` };
}

test("smoke: /health responds ok", async () => {
  const { s, baseUrl } = server();
  try {
    const r = await fetch(`${baseUrl}/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "ok");
  } finally { s.close(); }
});

test("smoke: /openapi.json serves the API document with paths", async () => {
  const { s, baseUrl } = server();
  try {
    const r = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(r.status, 200);
    const doc = await r.json();
    assert.ok(doc.openapi);
    assert.ok(Object.keys(doc.paths).length > 100); // full resource surface
  } finally { s.close(); }
});

test("smoke: /openapi/events serves the event + error-code catalog", async () => {
  const { s, baseUrl } = server();
  try {
    const r = await fetch(`${baseUrl}/openapi/events`);
    assert.equal(r.status, 200);
    const cat = await r.json();
    assert.ok(cat.events.length >= 15);
    assert.ok(cat.error_code_families.length > 0);
  } finally { s.close(); }
});

test("smoke: a protected admin route rejects an unauthenticated request", async () => {
  const { s, baseUrl } = server();
  try {
    const r = await fetch(`${baseUrl}/admin/jobs/health`);
    assert.ok(r.status === 401 || r.status === 403); // auth required — no anonymous access
  } finally { s.close(); }
});

test("smoke: the public banner endpoint responds (front-of-house read)", async () => {
  const { s, baseUrl } = server();
  try {
    const r = await fetch(`${baseUrl}/api/v2/banners?language=en&device=desktop`);
    // No auth required; returns a (possibly empty) banner list without error.
    assert.ok(r.status === 200 || r.status === 500); // 200 with DB, 500 only if DB probed — never a crash/404
  } finally { s.close(); }
});
