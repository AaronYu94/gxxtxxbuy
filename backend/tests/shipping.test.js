import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { DEFAULT_SHIPPING_LINES } from "../src/shipping/default-lines.js";
import { importShippingLines } from "../src/shipping/shipping-line-import.js";
import { signPaymentWebhook } from "../src/shipping/payment-webhook.js";
import { quoteShippingLine } from "../src/shipping/quote-calculator.js";
import { loginAdminWithTotp, MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";
import { MemoryShippingRepository } from "./helpers/memory-shipping-repository.js";
import { MemoryWalletRepository } from "./helpers/memory-wallet-repository.js";
import { MemoryWarehouseRepository } from "./helpers/memory-warehouse-repository.js";

const WEBHOOK_SECRET = "test-shipping-webhook-secret";

function createShippingTestApp() {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    SHIPPING_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SHIPPING_QUOTE_TTL_SECONDS: "900",
    STORAGE_DRIVER: "memory"
  });
  const shippingRepository = new MemoryShippingRepository();
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    core: new MemoryCoreRepository(),
    warehouse: new MemoryWarehouseRepository(),
    shipping: shippingRepository,
    wallet: new MemoryWalletRepository({ shippingRepository })
  };
  const app = createApp({ env, repositories });
  const server = app.listen(0);
  return {
    server,
    repositories,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function requestJson(baseUrl, path, { method = "GET", token = "", body = null, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null
  };
}

async function registerUser(baseUrl, email = "buyer@example.com") {
  return registerVerifiedUser(baseUrl, email);
}

async function createAdmin(repository, permissions = ["shipping:write"]) {
  await repository.createAdminUser({
    email: "ops@example.com",
    emailNormalized: normalizeEmail("ops@example.com"),
    passwordHash: await hashPassword("AdminPass123"),
    roles: ["warehouse_operator"],
    permissions
  });
}

async function loginAdmin(baseUrl) {
  return (await loginAdminWithTotp(baseUrl, "ops@example.com")).session.access_token;
}

function address(country = "United States") {
  return {
    recipient_name: "Buyer One",
    line1: "100 Market Street",
    city: "San Francisco",
    region: "CA",
    postal_code: "94105",
    country,
    phone: "+14155550123"
  };
}

async function createSubmittedParcel({ baseUrl, token, repository, user }) {
  const item = repository.seedWarehouseItem({ userId: user.id, weightGrams: 1250 });
  const draft = await requestJson(baseUrl, "/parcels/draft", {
    method: "POST",
    token,
    body: { warehouse_item_ids: [item.id] }
  });
  assert.equal(draft.response.status, 201);
  const preview = await requestJson(baseUrl, "/shipping/preview", {
    method: "POST",
    token,
    body: {
      parcel_id: draft.body.parcel.id,
      country: "United States",
      dimensions_cm: { length_cm: 30, width_cm: 20, height_cm: 12 }
    }
  });
  assert.equal(preview.response.status, 200);
  const quote = preview.body.quotes.find((entry) => entry.available);
  assert.ok(quote);
  const submit = await requestJson(baseUrl, "/parcels", {
    method: "POST",
    token,
    body: {
      parcel_id: draft.body.parcel.id,
      quote_id: quote.quote_id,
      address: address()
    }
  });
  assert.equal(submit.response.status, 201);
  return { parcel: submit.body.parcel, quote, item };
}

test("shipping line import is idempotent and quote calculator explains restrictions", async () => {
  const repository = new MemoryShippingRepository();
  const bulk = Array.from({ length: 151 }, (_, index) => ({
    ...DEFAULT_SHIPPING_LINES[0],
    code: `US-BULK-${String(index + 1).padStart(3, "0")}`,
    name: `Bulk Line ${index + 1}`
  }));

  const first = await importShippingLines(repository, bulk);
  const repeat = await importShippingLines(repository, bulk);
  assert.equal(first.imported, 151);
  assert.equal(repeat.imported, 151);
  assert.equal((await repository.listShippingLines("United States")).length, 151);

  const line = (await repository.listShippingLines("United States"))[0];
  const quote = quoteShippingLine(line, [{ weightGrams: 1000 }], { length_cm: 60, width_cm: 20, height_cm: 20 });
  assert.equal(quote.available, true);
  assert.ok(quote.volumetricWeightGrams > quote.actualWeightGrams);

  const unavailable = quoteShippingLine(line, [{ weightGrams: 40000 }], {});
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reasons[0].code, "MAX_WEIGHT_EXCEEDED");
});

test("parcel draft and shipping preview are scoped, duplicate-safe, and restriction-aware", async () => {
  const { server, baseUrl, repositories } = createShippingTestApp();
  try {
    await importShippingLines(repositories.shipping, DEFAULT_SHIPPING_LINES);
    const { token, user } = await registerUser(baseUrl);
    const badItem = repositories.shipping.seedWarehouseItem({ userId: user.id, status: "qc_ready", weightGrams: 1000 });
    const item = repositories.shipping.seedWarehouseItem({ userId: user.id, weightGrams: 1250 });

    const noToken = await requestJson(baseUrl, "/parcels/draft", {
      method: "POST",
      body: { warehouse_item_ids: [item.id] }
    });
    assert.equal(noToken.response.status, 401);

    const notReady = await requestJson(baseUrl, "/parcels/draft", {
      method: "POST",
      token,
      body: { warehouse_item_ids: [badItem.id] }
    });
    assert.equal(notReady.response.status, 409);

    const draft = await requestJson(baseUrl, "/parcels/draft", {
      method: "POST",
      token,
      body: { warehouse_item_ids: [item.id] }
    });
    assert.equal(draft.response.status, 201);
    assert.equal(draft.body.parcel.status, "draft");

    const repeat = await requestJson(baseUrl, "/parcels/draft", {
      method: "POST",
      token,
      body: { warehouse_item_ids: [item.id] }
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);

    const preview = await requestJson(baseUrl, "/shipping/preview", {
      method: "POST",
      token,
      body: {
        parcel_id: draft.body.parcel.id,
        country: "United States",
        dimensions_cm: { length_cm: 95, width_cm: 10, height_cm: 10 }
      }
    });
    assert.equal(preview.response.status, 200);
    assert.ok(preview.body.quotes.some((entry) => entry.available));
    assert.ok(preview.body.quotes.some((entry) => !entry.available && entry.reasons.length));
  } finally {
    server.close();
  }
});

test("parcel submit requires a fresh matching quote and complete address", async () => {
  const { server, baseUrl, repositories } = createShippingTestApp();
  try {
    await importShippingLines(repositories.shipping, DEFAULT_SHIPPING_LINES);
    const { token, user } = await registerUser(baseUrl);
    const item = repositories.shipping.seedWarehouseItem({ userId: user.id, weightGrams: 1250 });
    const draft = await requestJson(baseUrl, "/parcels/draft", {
      method: "POST",
      token,
      body: { warehouse_item_ids: [item.id] }
    });
    const preview = await requestJson(baseUrl, "/shipping/preview", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, country: "United States" }
    });
    const quote = preview.body.quotes.find((entry) => entry.available);

    const missingAddress = await requestJson(baseUrl, "/parcels", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, quote_id: quote.quote_id, address: {} }
    });
    assert.equal(missingAddress.response.status, 400);

    repositories.shipping.quotes.get(quote.quote_id).expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = await requestJson(baseUrl, "/parcels", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, quote_id: quote.quote_id, address: address() }
    });
    assert.equal(expired.response.status, 409);

    const freshPreview = await requestJson(baseUrl, "/shipping/preview", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, country: "United States" }
    });
    const freshQuote = freshPreview.body.quotes.find((entry) => entry.available);
    const submit = await requestJson(baseUrl, "/parcels", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, quote_id: freshQuote.quote_id, address: address() }
    });
    assert.equal(submit.response.status, 201);
    assert.equal(submit.body.parcel.status, "shipping_due");
    assert.equal(submit.body.parcel.final_fee_cents, freshQuote.amount_cents);

    const repeat = await requestJson(baseUrl, "/parcels", {
      method: "POST",
      token,
      body: { parcel_id: draft.body.parcel.id, quote_id: freshQuote.quote_id, address: address() }
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);
  } finally {
    server.close();
  }
});

test("shipping payment uses backend final fee and webhook is signed and idempotent", async () => {
  const { server, baseUrl, repositories } = createShippingTestApp();
  try {
    await importShippingLines(repositories.shipping, DEFAULT_SHIPPING_LINES);
    const { token, user } = await registerUser(baseUrl);
    const { parcel } = await createSubmittedParcel({ baseUrl, token, repository: repositories.shipping, user });

    const payment = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "ship-pay-1", amount_cents: 1 }
    });
    assert.equal(payment.response.status, 201);
    assert.equal(payment.body.payment.amount_cents, parcel.final_fee_cents);

    const repeat = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "ship-pay-1" }
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);

    const secondKey = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "ship-pay-2" }
    });
    assert.equal(secondKey.response.status, 409);

    const payload = {
      event_id: "evt_ship_1",
      payment_intent_id: payment.body.payment.payment_intent_id,
      status: "succeeded",
      amount_cents: parcel.final_fee_cents
    };
    const invalid = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: payload,
      headers: { "x-goatedbuy-signature": "bad" }
    });
    assert.equal(invalid.response.status, 403);

    const signature = signPaymentWebhook(payload, WEBHOOK_SECRET);
    const webhook = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: payload,
      headers: { "x-goatedbuy-signature": signature }
    });
    assert.equal(webhook.response.status, 202);
    assert.equal(webhook.body.payment.status, "succeeded");

    const duplicate = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: payload,
      headers: { "x-goatedbuy-signature": signature }
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.existing, true);

    const parcels = await requestJson(baseUrl, "/parcels", { token });
    assert.equal(parcels.body.parcels[0].status, "paid");
  } finally {
    server.close();
  }
});

test("tracking is pending until admin advances legal parcel status", async () => {
  const { server, baseUrl, repositories } = createShippingTestApp();
  try {
    await importShippingLines(repositories.shipping, DEFAULT_SHIPPING_LINES);
    const { token, user } = await registerUser(baseUrl);
    const other = await registerUser(baseUrl, "other@example.com");
    const { parcel } = await createSubmittedParcel({ baseUrl, token, repository: repositories.shipping, user });
    const payment = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "ship-pay-track" }
    });
    const payload = {
      event_id: "evt_track_paid",
      payment_intent_id: payment.body.payment.payment_intent_id,
      status: "succeeded",
      amount_cents: payment.body.payment.amount_cents
    };
    await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: payload,
      headers: { "x-goatedbuy-signature": signPaymentWebhook(payload, WEBHOOK_SECRET) }
    });

    const pending = await requestJson(baseUrl, `/parcels/${parcel.id}/tracking`, { token });
    assert.equal(pending.response.status, 200);
    assert.equal(pending.body.tracking.status, "pending");
    assert.equal(pending.body.tracking.tracking_number, null);
    assert.deepEqual(pending.body.tracking.events, []);

    const otherTracking = await requestJson(baseUrl, `/parcels/${parcel.id}/tracking`, { token: other.token });
    assert.equal(otherTracking.response.status, 404);

    await createAdmin(repositories.auth, ["shipping:write"]);
    const adminToken = await loginAdmin(baseUrl);
    const illegal = await requestJson(baseUrl, `/admin/parcels/${parcel.id}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "dispatched", tracking_number: "GB123" }
    });
    assert.equal(illegal.response.status, 409);

    const processing = await requestJson(baseUrl, `/admin/parcels/${parcel.id}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "processing", location: "China warehouse" }
    });
    assert.equal(processing.response.status, 200);

    const missingTracking = await requestJson(baseUrl, `/admin/parcels/${parcel.id}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "dispatched" }
    });
    assert.equal(missingTracking.response.status, 400);

    const dispatched = await requestJson(baseUrl, `/admin/parcels/${parcel.id}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "dispatched", tracking_number: "GB123", location: "Shenzhen" }
    });
    assert.equal(dispatched.response.status, 200);
    assert.equal(dispatched.body.parcel.tracking_number, "GB123");

    const tracking = await requestJson(baseUrl, `/parcels/${parcel.id}/tracking`, { token });
    assert.equal(tracking.body.tracking.status, "dispatched");
    assert.equal(tracking.body.tracking.tracking_number, "GB123");
    assert.equal(tracking.body.tracking.events.length, 2);
  } finally {
    server.close();
  }
});
