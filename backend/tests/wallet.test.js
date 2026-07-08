import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { DEFAULT_SHIPPING_LINES } from "../src/shipping/default-lines.js";
import { importShippingLines } from "../src/shipping/shipping-line-import.js";
import { signPaymentWebhook } from "../src/shipping/payment-webhook.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";
import { MemoryShippingRepository } from "./helpers/memory-shipping-repository.js";
import { MemoryWalletRepository } from "./helpers/memory-wallet-repository.js";
import { MemoryWarehouseRepository } from "./helpers/memory-warehouse-repository.js";

const WEBHOOK_SECRET = "test-shipping-webhook-secret";

function createWalletTestApp(options = {}) {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    STORAGE_DRIVER: "memory",
    SHIPPING_WEBHOOK_SECRET: WEBHOOK_SECRET,
    WELCOME_GIFT_ENABLED: String(options.welcomeGiftEnabled ?? true),
    WELCOME_GIFT_CODE: "WELCOME10",
    WELCOME_GIFT_AMOUNT_CENTS: "1000"
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
  const result = await requestJson(baseUrl, "/auth/register", {
    method: "POST",
    body: { email, password: "CorrectHorse123" }
  });
  assert.equal(result.response.status, 201);
  return {
    token: result.body.session.access_token,
    user: result.body.user
  };
}

async function createAdmin(repository, permissions, email = "admin@example.com") {
  await repository.createAdminUser({
    email,
    emailNormalized: normalizeEmail(email),
    passwordHash: await hashPassword("AdminPass123"),
    roles: ["operations"],
    permissions
  });
}

async function loginAdmin(baseUrl, email = "admin@example.com") {
  const result = await requestJson(baseUrl, "/admin/auth/login", {
    method: "POST",
    body: { email, password: "AdminPass123" }
  });
  assert.equal(result.response.status, 200);
  return result.body.session.access_token;
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

async function createAdminCoupon(baseUrl, adminToken, patch = {}) {
  const result = await requestJson(baseUrl, "/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: {
      code: "SHIP8",
      title: "Shipping $8",
      amount: 8,
      eligible_shipping_line_codes: ["US-BALANCED-AIR"],
      min_shipping_fee_cents: 1000,
      ...patch
    }
  });
  assert.equal(result.response.status, 201);
  return result.body.coupon;
}

async function createSubmittedParcel({ baseUrl, token, repository, user }) {
  await importShippingLines(repository, DEFAULT_SHIPPING_LINES);
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
    body: { parcel_id: draft.body.parcel.id, country: "United States" }
  });
  assert.equal(preview.response.status, 200);
  const quote = preview.body.quotes.find((entry) => entry.available && entry.line.code === "US-BALANCED-AIR");
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
  return {
    parcel: submit.body.parcel,
    quote,
    item
  };
}

test("wallet query is user scoped and balance is numeric", async () => {
  const { server, baseUrl } = createWalletTestApp();
  try {
    const noToken = await requestJson(baseUrl, "/wallet");
    assert.equal(noToken.response.status, 401);

    const { token } = await registerUser(baseUrl);
    const wallet = await requestJson(baseUrl, "/wallet", { token });
    assert.equal(wallet.response.status, 200);
    assert.equal(wallet.body.wallet.balance_cents, 0);
    assert.equal(wallet.body.wallet.balance, 0);
    assert.equal(Number.isNaN(wallet.body.wallet.balance), false);
    assert.deepEqual(wallet.body.transactions, []);
    assert.deepEqual(wallet.body.coupons, []);
  } finally {
    server.close();
  }
});

test("admin coupon creation and code redemption handle duplicate and invalid states", async () => {
  const { server, baseUrl, repositories } = createWalletTestApp();
  try {
    const { token } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["ops:policy:write"]);
    const adminToken = await loginAdmin(baseUrl);

    const coupon = await createAdminCoupon(baseUrl, adminToken);
    assert.equal(coupon.amount_cents, 800);

    const redeem = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "ship8" }
    });
    assert.equal(redeem.response.status, 201);
    assert.equal(redeem.body.user_coupon.coupon.code, "SHIP8");

    const duplicate = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "SHIP8" }
    });
    assert.equal(duplicate.response.status, 409);

    await createAdminCoupon(baseUrl, adminToken, {
      code: "OLD",
      title: "Expired",
      expires_at: "2026-01-01T00:00:00.000Z"
    });
    const expired = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "OLD" }
    });
    assert.equal(expired.response.status, 409);

    const missing = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "NOPE" }
    });
    assert.equal(missing.response.status, 404);
  } finally {
    server.close();
  }
});

test("welcome gift is configurable and can only be claimed once per user", async () => {
  const enabledApp = createWalletTestApp();
  try {
    const { token } = await registerUser(enabledApp.baseUrl);
    const first = await requestJson(enabledApp.baseUrl, "/welcome-gift/claim", {
      method: "POST",
      token
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.body.user_coupon.coupon.code, "WELCOME10");

    const repeat = await requestJson(enabledApp.baseUrl, "/welcome-gift/claim", {
      method: "POST",
      token
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);
  } finally {
    enabledApp.server.close();
  }

  const disabledApp = createWalletTestApp({ welcomeGiftEnabled: false });
  try {
    const { token } = await registerUser(disabledApp.baseUrl);
    const disabled = await requestJson(disabledApp.baseUrl, "/welcome-gift/claim", {
      method: "POST",
      token
    });
    assert.equal(disabled.response.status, 409);
  } finally {
    disabledApp.server.close();
  }
});

test("checkout coupon apply locks only eligible coupons and updates parcel fee", async () => {
  const { server, baseUrl, repositories } = createWalletTestApp();
  try {
    const { token, user } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["finance:wallet:write"]);
    const adminToken = await loginAdmin(baseUrl);
    await createAdminCoupon(baseUrl, adminToken);
    await createAdminCoupon(baseUrl, adminToken, {
      code: "OTHERLINE",
      title: "Wrong line",
      eligible_shipping_line_codes: ["US-EXPRESS"]
    });
    const { parcel } = await createSubmittedParcel({ baseUrl, token, repository: repositories.shipping, user });

    const redeem = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "SHIP8" }
    });
    const wrong = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "OTHERLINE" }
    });

    const ineligible = await requestJson(baseUrl, "/checkout/apply-coupon", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, user_coupon_id: wrong.body.user_coupon.id }
    });
    assert.equal(ineligible.response.status, 409);
    assert.equal(ineligible.body.error.details.reasons[0].code, "LINE_NOT_ELIGIBLE");

    const apply = await requestJson(baseUrl, "/checkout/apply-coupon", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, user_coupon_id: redeem.body.user_coupon.id }
    });
    assert.equal(apply.response.status, 201);
    assert.equal(apply.body.application.discount_cents, 800);
    assert.equal(apply.body.application.final_fee_cents, parcel.final_fee_cents - 800);

    const repeat = await requestJson(baseUrl, "/checkout/apply-coupon", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, user_coupon_id: redeem.body.user_coupon.id }
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);

    const wallet = await requestJson(baseUrl, "/wallet", { token });
    const locked = wallet.body.coupons.find((entry) => entry.coupon.code === "SHIP8");
    assert.equal(locked.status, "locked");
  } finally {
    server.close();
  }
});

test("payment failed rolls locked coupon back once and payment success settles it", async () => {
  const { server, baseUrl, repositories } = createWalletTestApp();
  try {
    const { token, user } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["finance:wallet:write"]);
    const adminToken = await loginAdmin(baseUrl);
    await createAdminCoupon(baseUrl, adminToken);
    const { parcel } = await createSubmittedParcel({ baseUrl, token, repository: repositories.shipping, user });
    const redeem = await requestJson(baseUrl, "/coupons/redeem-code", {
      method: "POST",
      token,
      body: { code: "SHIP8" }
    });
    await requestJson(baseUrl, "/checkout/apply-coupon", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, user_coupon_id: redeem.body.user_coupon.id }
    });
    const discounted = repositories.shipping.parcels.get(parcel.id).finalFeeCents;
    assert.equal(discounted, parcel.final_fee_cents - 800);

    const payment = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "coupon-fail" }
    });
    assert.equal(payment.body.payment.amount_cents, discounted);
    const failedPayload = {
      event_id: "evt_coupon_failed",
      payment_intent_id: payment.body.payment.payment_intent_id,
      status: "failed",
      amount_cents: discounted
    };
    const failedSignature = signPaymentWebhook(failedPayload, WEBHOOK_SECRET);
    const failed = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: failedPayload,
      headers: { "x-goatedbuy-signature": failedSignature }
    });
    assert.equal(failed.response.status, 202);
    assert.equal(repositories.shipping.parcels.get(parcel.id).finalFeeCents, parcel.final_fee_cents);
    assert.equal(repositories.shipping.parcels.get(parcel.id).status, "shipping_due");

    const duplicate = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: failedPayload,
      headers: { "x-goatedbuy-signature": failedSignature }
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(repositories.wallet.applications.size, 1);
    assert.equal(Array.from(repositories.wallet.applications.values())[0].status, "rolled_back");

    const walletAfterFail = await requestJson(baseUrl, "/wallet", { token });
    const available = walletAfterFail.body.coupons.find((entry) => entry.coupon.code === "SHIP8");
    assert.equal(available.status, "available");

    const applyAgain = await requestJson(baseUrl, "/checkout/apply-coupon", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, user_coupon_id: redeem.body.user_coupon.id }
    });
    assert.equal(applyAgain.response.status, 201);
    const secondDiscounted = repositories.shipping.parcels.get(parcel.id).finalFeeCents;
    const secondPayment = await requestJson(baseUrl, "/shipping-payments", {
      method: "POST",
      token,
      body: { parcel_id: parcel.id, idempotency_key: "coupon-success" }
    });
    const successPayload = {
      event_id: "evt_coupon_success",
      payment_intent_id: secondPayment.body.payment.payment_intent_id,
      status: "succeeded",
      amount_cents: secondDiscounted
    };
    const success = await requestJson(baseUrl, "/webhooks/shipping-payments", {
      method: "POST",
      body: successPayload,
      headers: { "x-goatedbuy-signature": signPaymentWebhook(successPayload, WEBHOOK_SECRET) }
    });
    assert.equal(success.response.status, 202);
    const walletAfterSuccess = await requestJson(baseUrl, "/wallet", { token });
    const used = walletAfterSuccess.body.coupons.find((entry) => entry.coupon.code === "SHIP8");
    assert.equal(used.status, "used");
  } finally {
    server.close();
  }
});

test("admin wallet credit requires finance permission and reason", async () => {
  const { server, baseUrl, repositories } = createWalletTestApp();
  try {
    const { user } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["ops:policy:write"], "ops@example.com");
    await createAdmin(repositories.auth, ["finance:wallet:write"], "finance@example.com");
    const opsToken = await loginAdmin(baseUrl, "ops@example.com");
    const financeToken = await loginAdmin(baseUrl, "finance@example.com");

    const denied = await requestJson(baseUrl, `/admin/wallets/${user.id}/credit`, {
      method: "PATCH",
      token: opsToken,
      body: { amount_cents: 500, reason: "Support credit" }
    });
    assert.equal(denied.response.status, 403);

    const missingReason = await requestJson(baseUrl, `/admin/wallets/${user.id}/credit`, {
      method: "PATCH",
      token: financeToken,
      body: { amount_cents: 500 }
    });
    assert.equal(missingReason.response.status, 400);

    const credit = await requestJson(baseUrl, `/admin/wallets/${user.id}/credit`, {
      method: "PATCH",
      token: financeToken,
      body: { amount_cents: 500, reason: "Support credit" }
    });
    assert.equal(credit.response.status, 200);
    assert.equal(credit.body.wallet.balance_cents, 500);
    assert.equal(credit.body.transaction.reason, "Support credit");

    const underflow = await requestJson(baseUrl, `/admin/wallets/${user.id}/credit`, {
      method: "PATCH",
      token: financeToken,
      body: { amount_cents: -600, reason: "Remove credit" }
    });
    assert.equal(underflow.response.status, 409);
  } finally {
    server.close();
  }
});
