import assert from "node:assert/strict";
import test from "node:test";
import { createFinanceService } from "../src/finance/finance-service.js";
import { MemoryFinanceRepository } from "./helpers/memory-finance-repository.js";
import { createStubPaymentProvider } from "../src/finance/payment-provider.js";

const USER = { id: "44444444-4444-4444-4444-444444444444" };
const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };

function setup() {
  const provider = createStubPaymentProvider({ secret: "test-secret-123456" });
  const fin = createFinanceService({ repository: new MemoryFinanceRepository(), paymentProvider: provider, env: {} });
  return { fin, provider };
}

function webhookBody(top, overrides = {}) {
  return {
    provider_txn_id: `stub_${top.top_up_no}`,
    amount_minor: top.original_amount_minor,
    currency: top.original_currency,
    status: "succeeded",
    top_up_no: top.top_up_no,
    ...overrides
  };
}

test("exchange rates are versioned; only the newest is active", async () => {
  const { fin } = setup();
  await fin.setExchangeRate(ADMIN, { currency: "USD", cny_per_unit: 7.2 });
  await fin.setExchangeRate(ADMIN, { currency: "USD", cny_per_unit: 7.5 });
  const { rates } = await fin.listExchangeRates("USD");
  const active = rates.filter((r) => r.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].version, 2);
  assert.equal(active[0].cny_per_unit_micro, 7500000);
});

test("create top-up enforces the 10 CNY minimum and is idempotent", async () => {
  const { fin } = setup();
  const created = await fin.createTopUp(USER, { amount: 100, currency: "CNY", idempotency_key: "tu-1" });
  assert.equal(created.top_up.cny_credited_minor, 10000);
  assert.equal(created.top_up.system_status, "pending_provider");
  assert.ok(created.redirect_url);

  const dup = await fin.createTopUp(USER, { amount: 100, currency: "CNY", idempotency_key: "tu-1" });
  assert.equal(dup.existing, true);
  assert.equal(dup.top_up.id, created.top_up.id);

  await assert.rejects(() => fin.createTopUp(USER, { amount: 5, currency: "CNY" }), (e) => e.statusCode === 400);
});

test("a valid webhook settles the top-up once and credits the wallet", async () => {
  const { fin, provider } = setup();
  const top = (await fin.createTopUp(USER, { amount: 100, currency: "CNY" })).top_up;
  const body = webhookBody(top);
  const signature = provider.signBody(body);

  const first = await fin.handlePaymentWebhook({ body, signature });
  assert.equal(first.settled, true);
  assert.equal(first.top_up.system_status, "succeeded");
  assert.equal((await fin.getBalance(USER.id)).wallet.available_cny_minor, 10000);

  // Duplicate / out-of-order webhook credits nothing more.
  const replay = await fin.handlePaymentWebhook({ body, signature });
  assert.equal(replay.settled, false);
  assert.equal((await fin.getBalance(USER.id)).wallet.available_cny_minor, 10000);
});

test("a tampered signature is rejected", async () => {
  const { fin } = setup();
  const top = (await fin.createTopUp(USER, { amount: 100, currency: "CNY" })).top_up;
  await assert.rejects(
    () => fin.handlePaymentWebhook({ body: webhookBody(top), signature: "deadbeef" }),
    (e) => e.statusCode === 400
  );
});

test("an amount mismatch marks the top-up exception and does not credit", async () => {
  const { fin, provider } = setup();
  const top = (await fin.createTopUp(USER, { amount: 100, currency: "CNY" })).top_up;
  const body = webhookBody(top, { amount_minor: 5000 }); // wrong amount
  const signature = provider.signBody(body);
  await assert.rejects(() => fin.handlePaymentWebhook({ body, signature }), (e) => e.statusCode === 409);
  assert.equal((await fin.getBalance(USER.id)).wallet.available_cny_minor, 0);
});
