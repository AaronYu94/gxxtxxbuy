import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";
import { MemoryOrderRepository } from "./helpers/memory-order-repository.js";

function createOrderTestApp() {
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
    catalog: new MemoryCatalogRepository(),
    order: new MemoryOrderRepository()
  };
  const queue = { async enqueue(_queueName, payload) { return { id: "job_1", payload }; } };
  const app = createApp({ env, repositories, queue, parseInline: true });
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

let urlSeed = 100;
// Seed a purchasable manual snapshot (known domestic shipping) and return its id.
async function makeSnapshot(baseUrl, token, { title = "Sneaker", price = 199.9, domestic_shipping = 6 } = {}) {
  const url = `https://item.taobao.com/item.htm?id=${urlSeed++}`;
  const job = (await requestJson(baseUrl, "/api/v2/catalog/parse-jobs", { method: "POST", token, body: { url } })).body.job;
  const body = { title, price, ...(domestic_shipping === null ? {} : { domestic_shipping }) };
  const filled = await requestJson(baseUrl, `/api/v2/catalog/parse-jobs/${job.id}/manual-fill`, { method: "POST", token, body });
  return filled.body.snapshot;
}

test("create order mints GO-PO/GO-ITEM numbers and aggregates the payment total", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer@example.com");

  const a = await makeSnapshot(app.baseUrl, token, { price: 199.9, domestic_shipping: 6 }); // 19990 + 600
  const b = await makeSnapshot(app.baseUrl, token, { price: 50, domestic_shipping: 3 });     // 5000 + 300

  const created = await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token,
    body: { submit_key: "cart-1", items: [
      { snapshot_id: a.id, quantity: 2 },   // 2*19990 + 600 = 40580
      { snapshot_id: b.id, quantity: 1 }     // 5000 + 300 = 5300
    ] }
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.existing, false);
  const order = created.body.order;
  assert.match(order.order_no, /^GO-PO-[0-9A-Z]{20}$/);
  assert.equal(order.item_count, 2);
  assert.equal(order.items_total_cents, 45880);
  assert.equal(order.payment_status, "unpaid");
  assert.equal(order.items.length, 2);
  assert.match(order.items[0].item_no, /^GO-ITEM-[0-9A-Z]{20}$/);
  assert.equal(order.items[0].total_cents, 40580);
  assert.equal(order.items[0].fulfillment_status, "pending_payment");
  assert.equal(order.items[0].exception_status, "none");
  assert.equal(order.items[1].total_cents, 5300);
});

test("a repeated submit key is idempotent — same parent order, no second row", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer2@example.com");
  const snap = await makeSnapshot(app.baseUrl, token);

  const body = { submit_key: "cart-dup", items: [{ snapshot_id: snap.id, quantity: 1 }] };
  const first = await requestJson(app.baseUrl, "/api/v2/orders", { method: "POST", token, body });
  const second = await requestJson(app.baseUrl, "/api/v2/orders", { method: "POST", token, body });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.existing, true);
  assert.equal(second.body.order.id, first.body.order.id);

  const list = await requestJson(app.baseUrl, "/api/v2/orders", { token });
  assert.equal(list.body.orders.length, 1);
});

test("a stale expected price forces a re-confirm (409)", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer3@example.com");
  const snap = await makeSnapshot(app.baseUrl, token, { price: 199.9 }); // 19990

  const stale = await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token,
    body: { submit_key: "cart-stale", items: [{ snapshot_id: snap.id, quantity: 1, expected_unit_price_cents: 18000 }] }
  });
  assert.equal(stale.response.status, 409);
});

test("an item with unknown domestic shipping is not purchasable (409) and no order is created", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer4@example.com");
  const ok = await makeSnapshot(app.baseUrl, token, { price: 20, domestic_shipping: 2 });
  const noShip = await makeSnapshot(app.baseUrl, token, { price: 20, domestic_shipping: null });

  const blocked = await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token,
    body: { submit_key: "cart-noship", items: [
      { snapshot_id: ok.id, quantity: 1 },
      { snapshot_id: noShip.id, quantity: 1 }
    ] }
  });
  assert.equal(blocked.response.status, 409);

  // All-or-nothing: the good item must not have produced a parent order.
  const list = await requestJson(app.baseUrl, "/api/v2/orders", { token });
  assert.equal(list.body.orders.length, 0);
});

test("a missing snapshot rolls back the whole order (404, nothing created)", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const { token } = await registerVerifiedUser(app.baseUrl, "buyer5@example.com");
  const ok = await makeSnapshot(app.baseUrl, token);

  const result = await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token,
    body: { submit_key: "cart-bad", items: [
      { snapshot_id: ok.id, quantity: 1 },
      { snapshot_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }
    ] }
  });
  assert.equal(result.response.status, 404);
  const list = await requestJson(app.baseUrl, "/api/v2/orders", { token });
  assert.equal(list.body.orders.length, 0);
});

test("orders and snapshots are strictly owner-scoped", async (t) => {
  const app = createOrderTestApp();
  t.after(() => app.server.close());
  const owner = (await registerVerifiedUser(app.baseUrl, "owner@example.com")).token;
  const intruder = (await registerVerifiedUser(app.baseUrl, "intruder@example.com")).token;
  const snap = await makeSnapshot(app.baseUrl, owner);

  const order = (await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token: owner, body: { submit_key: "cart-own", items: [{ snapshot_id: snap.id, quantity: 1 }] }
  })).body.order;

  // Intruder cannot read the owner's order.
  assert.equal((await requestJson(app.baseUrl, `/api/v2/orders/${order.id}`, { token: intruder })).response.status, 404);
  // Intruder cannot order against the owner's snapshot.
  const cross = await requestJson(app.baseUrl, "/api/v2/orders", {
    method: "POST", token: intruder, body: { submit_key: "cart-cross", items: [{ snapshot_id: snap.id, quantity: 1 }] }
  });
  assert.equal(cross.response.status, 404);
  // Owner can read it.
  assert.equal((await requestJson(app.baseUrl, `/api/v2/orders/${order.id}`, { token: owner })).response.status, 200);
});
