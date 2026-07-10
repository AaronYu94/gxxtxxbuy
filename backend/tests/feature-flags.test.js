import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";
import { MemoryCreatorRepository } from "./helpers/memory-creator-repository.js";
import { MemoryShippingRepository } from "./helpers/memory-shipping-repository.js";
import { MemoryWalletRepository } from "./helpers/memory-wallet-repository.js";

function createApp503TestApp(overrides = {}) {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    STORAGE_DRIVER: "memory",
    SHIPPING_WEBHOOK_SECRET: "test-secret",
    ...overrides
  });
  const shippingRepository = new MemoryShippingRepository();
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    shipping: shippingRepository,
    wallet: new MemoryWalletRepository({ shippingRepository }),
    creator: new MemoryCreatorRepository()
  };
  const app = createApp({ env, repositories });
  const server = app.listen(0);
  return { server, env, baseUrl: `http://127.0.0.1:${server.address().port}` };
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

async function registerUser(baseUrl, email = "buyer@example.com") {
  return (await registerVerifiedUser(baseUrl, email)).token;
}

test("feature flags default on and gate the guarded routes with 503 when disabled", async () => {
  // Flags default on: guarded routes are reachable (they fail later for other reasons, not FEATURE_DISABLED).
  const on = createApp503TestApp();
  try {
    assert.equal(on.env.features.payments, true);
    assert.equal(on.env.features.coupons, true);
    assert.equal(on.env.features.creators, true);
    assert.equal(on.env.features.shipping, true);
  } finally {
    on.server.close();
  }

  const off = createApp503TestApp({
    FEATURE_PAYMENTS_ENABLED: "false",
    FEATURE_COUPONS_ENABLED: "false",
    FEATURE_CREATORS_ENABLED: "false",
    FEATURE_SHIPPING_ENABLED: "false"
  });
  try {
    const token = await registerUser(off.baseUrl);

    const payment = await requestJson(off.baseUrl, "/shipping-payments", { method: "POST", token, body: { parcel_id: "x" } });
    assert.equal(payment.response.status, 503);
    assert.equal(payment.body.error.details.code, "FEATURE_DISABLED");
    assert.equal(payment.body.error.details.feature, "payments");

    const coupon = await requestJson(off.baseUrl, "/coupons/redeem-code", { method: "POST", token, body: { code: "SHIP8" } });
    assert.equal(coupon.response.status, 503);
    assert.equal(coupon.body.error.details.feature, "coupons");

    const draft = await requestJson(off.baseUrl, "/parcels/draft", { method: "POST", token, body: {} });
    assert.equal(draft.response.status, 503);
    assert.equal(draft.body.error.details.feature, "shipping");

    const touch = await requestJson(off.baseUrl, "/creator-campaign/touch", { method: "POST", body: { creator_code: "GOAT" } });
    assert.equal(touch.response.status, 503);
    assert.equal(touch.body.error.details.feature, "creators");

    // Non-flagged routes stay available even when features are off.
    const lines = await requestJson(off.baseUrl, "/shipping-lines");
    assert.equal(lines.response.status, 200);
  } finally {
    off.server.close();
  }
});
