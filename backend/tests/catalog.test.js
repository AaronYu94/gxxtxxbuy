import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { createProductSourceRegistry } from "../src/parsing/adapters/registry.js";

function createCatalogTestApp(options = {}) {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false"
  });
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    catalog: options.catalogRepository || new MemoryCatalogRepository()
  };
  const queue = { async enqueue(_queueName, payload) { return { id: "job_1", payload }; } };
  const app = createApp({
    env,
    repositories,
    queue,
    parseInline: true, // resolve synchronously so tests can assert the outcome
    productSourceRegistry: options.productSourceRegistry
  });
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

const TAOBAO_URL = "https://item.taobao.com/item.htm?id=770241188";

test("parse submit degrades to manual with no approved provider and deduplicates", async (t) => {
  const app = createCatalogTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer@example.com");

  const first = await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url: TAOBAO_URL } });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.job.status, "manual");
  assert.equal(first.body.job.reason, "not_configured"); // honest degradation, never fake data

  // Same canonical link (extra tracking param) → same job, not a second row.
  const dup = await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", {
    method: "POST", token, body: { url: `${TAOBAO_URL}&spm=a1z0d.tracking` }
  });
  assert.equal(dup.response.status, 200);
  assert.equal(dup.body.existing, true);
  assert.equal(dup.body.job.id, first.body.job.id);

  const list = await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { token });
  assert.equal(list.body.jobs.length, 1);
});

test("manual-fill creates a manual-source snapshot and price calc respects known vs unknown shipping", async (t) => {
  const app = createCatalogTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer2@example.com");
  const job = (await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url: TAOBAO_URL } })).body.job;

  const filled = await requestJson(app.baseUrl, `/api/v2/catalog/parse-jobs/${job.id}/manual-fill`, {
    method: "POST", token,
    body: { title: "Retro Sneaker", price: 199.9, domestic_shipping: 6, spec: "Black / 42", currency: "CNY" }
  });
  assert.equal(filled.response.status, 201);
  assert.equal(filled.body.snapshot.source, "manual"); // distinct from scraped
  assert.equal(filled.body.snapshot.price_cents, 19990);
  const snapshotId = filled.body.snapshot.id;

  const priced = await requestJson(app.baseUrl, "/api/v2/catalog/price-calculations", {
    method: "POST", token, body: { snapshot_id: snapshotId, quantity: 2 }
  });
  assert.equal(priced.response.status, 201);
  assert.equal(priced.body.calculation.items_cents, 39980);
  assert.equal(priced.body.calculation.total_cents, 40580);
  assert.equal(priced.body.calculation.purchasable, true);

  // A snapshot with unknown shipping cannot produce a purchasable total.
  const noShip = (await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url: "https://weidian.com/item.html?itemID=99" } })).body.job;
  const noShipSnap = (await requestJson(app.baseUrl, `/api/v2/catalog/parse-jobs/${noShip.id}/manual-fill`, {
    method: "POST", token, body: { title: "No Ship", price: 50 }
  })).body.snapshot;
  const unknownPrice = await requestJson(app.baseUrl, "/api/v2/catalog/price-calculations", {
    method: "POST", token, body: { snapshot_id: noShipSnap.id, quantity: 1 }
  });
  assert.equal(unknownPrice.body.calculation.purchasable, false);
  assert.equal(unknownPrice.body.calculation.total_cents, null);
  assert.equal(unknownPrice.body.calculation.reason, "domestic_shipping_unknown");
});

test("catalog records are strictly owner-scoped", async (t) => {
  const app = createCatalogTestApp();
  t.after(() => app.server.close());
  const owner = (await registerVerifiedUser(app.baseUrl, "owner@example.com")).token;
  const intruder = (await registerVerifiedUser(app.baseUrl, "intruder@example.com")).token;

  const job = (await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token: owner, body: { url: TAOBAO_URL } })).body.job;
  const snapshot = (await requestJson(app.baseUrl, `/api/v2/catalog/parse-jobs/${job.id}/manual-fill`, {
    method: "POST", token: owner, body: { title: "Owned", price: 10, domestic_shipping: 1 }
  })).body.snapshot;

  assert.equal((await requestJson(app.baseUrl, `/api/v2/catalog/parse-jobs/${job.id}`, { token: intruder })).response.status, 404);
  assert.equal((await requestJson(app.baseUrl, `/api/v2/catalog/snapshots/${snapshot.id}`, { token: intruder })).response.status, 404);
  assert.equal((await requestJson(app.baseUrl, `/api/v2/catalog/snapshots/${snapshot.id}`, { token: owner })).response.status, 200);
});

test("a wired provider snapshots scraped data and guards against stale prices", async (t) => {
  const providers = {
    Taobao: {
      async fetch() {
        return { title: "Tech Fleece", priceYuan: 320, domesticShippingYuan: 8, shopName: "GOAT", images: ["a.jpg"], skus: [{ spec: "Black / L", priceYuan: 320, stock: 5 }] };
      }
    }
  };
  const app = createCatalogTestApp({ productSourceRegistry: createProductSourceRegistry({ providers }) });
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer3@example.com");

  const submit = await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url: TAOBAO_URL } });
  assert.equal(submit.body.job.status, "snapshotted");
  const detail = await requestJson(app.baseUrl, `/api/v2/catalog/parse-jobs/${submit.body.job.id}`, { token });
  assert.equal(detail.body.snapshot.source, "scraped");
  assert.equal(detail.body.snapshot.price_cents, 32000);
  const snapshotId = detail.body.snapshot.id;

  // Stale expected price → 409 so the UI forces a re-confirm.
  const stale = await requestJson(app.baseUrl, "/api/v2/catalog/price-calculations", {
    method: "POST", token, body: { snapshot_id: snapshotId, quantity: 1, spec: "Black / L", expected_unit_price_cents: 31000 }
  });
  assert.equal(stale.response.status, 409);

  // Invalid spec is rejected.
  const badSpec = await requestJson(app.baseUrl, "/api/v2/catalog/price-calculations", {
    method: "POST", token, body: { snapshot_id: snapshotId, quantity: 1, spec: "Purple / XXL" }
  });
  assert.equal(badSpec.response.status, 400);
});

test("a wired provider missing required fields degrades the job to manual", async (t) => {
  const providers = { Taobao: { async fetch() { return { title: "No Price" }; } } };
  const app = createCatalogTestApp({ productSourceRegistry: createProductSourceRegistry({ providers }) });
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer4@example.com");
  const submit = await requestJson(app.baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url: TAOBAO_URL } });
  assert.equal(submit.body.job.status, "manual");
  assert.equal(submit.body.job.reason, "missing_fields");
});
