import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { MemoryAccountRepository } from "./helpers/memory-account-repository.js";
import { MemoryAuditRepository, MemoryAuthRepository, registerVerifiedUser } from "./helpers/memory-auth-repository.js";

function createAccountTestApp(options = {}) {
  const env = parseEnv({
    NODE_ENV: "test", PORT: "3000", REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false", READY_REQUIRES_REDIS: "false",
    ACCOUNT_ADDRESS_HMAC_SECRET: "test-address-hmac-secret"
  });
  const auth = new MemoryAuthRepository();
  const account = new MemoryAccountRepository(auth, options);
  const audit = new MemoryAuditRepository();
  const app = createApp({ env, repositories: { auth, account, audit } });
  const server = app.listen(0);
  return { server, repositories: { auth, account, audit }, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function requestJson(baseUrl, path, { method = "GET", token = "", body, version } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(version ? { "if-match": `"${version}"` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("account settings are versioned and phone changes remain explicitly unverified", async () => {
  const { server, baseUrl, repositories } = createAccountTestApp();
  try {
    const user = await registerVerifiedUser(baseUrl, "settings@example.com");
    const current = await requestJson(baseUrl, "/api/v2/account", { token: user.token });
    assert.equal(current.response.status, 200);
    assert.equal(current.body.data.version, 1);
    assert.ok(current.body.meta.request_id);

    const updated = await requestJson(baseUrl, "/api/v2/account", {
      method: "PATCH", token: user.token,
      body: {
        expected_version: 1, display_name: "Global Buyer", phone: "+14155550123",
        country_code: "US", default_locale: "en-US", default_currency: "CNY"
      }
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.version, 2);
    assert.equal(updated.body.data.phone_verified, false);
    assert.equal(updated.body.data.default_currency, "CNY");

    const stale = await requestJson(baseUrl, "/api/v2/account", {
      method: "PATCH", token: user.token,
      body: { expected_version: 1, display_name: "Stale", default_locale: "en-US", default_currency: "USD" }
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.error.code, "VERSION_CONFLICT");
    assert.ok(repositories.audit.logs.some((log) => log.action === "account.profile.update"));
  } finally { server.close(); }
});

test("addresses are user-scoped, default-safe, hash-private, and optimistic-lock protected", async () => {
  const { server, baseUrl, repositories } = createAccountTestApp();
  try {
    const firstUser = await registerVerifiedUser(baseUrl, "address@example.com");
    const otherUser = await registerVerifiedUser(baseUrl, "other-address@example.com");
    const first = await requestJson(baseUrl, "/api/v2/addresses", {
      method: "POST", token: firstUser.token, body: addressBody({ line1: "100 Market Street" })
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.body.data.is_default, true);
    const second = await requestJson(baseUrl, "/api/v2/addresses", {
      method: "POST", token: firstUser.token, body: addressBody({ line1: "200 Pine Street", is_default: true })
    });
    assert.equal(second.body.data.is_default, true);

    const list = await requestJson(baseUrl, "/api/v2/addresses", { token: firstUser.token });
    assert.equal(list.body.data.length, 2);
    assert.equal(list.body.data.filter((entry) => entry.is_default).length, 1);
    assert.equal(list.body.data[0].id, second.body.data.id);
    assert.equal(list.body.data[0].normalized_hash, undefined);

    const forbiddenAsNotFound = await requestJson(baseUrl, `/api/v2/addresses/${second.body.data.id}`, {
      method: "PATCH", token: otherUser.token,
      body: { ...addressBody(), expected_version: second.body.data.version }
    });
    assert.equal(forbiddenAsNotFound.response.status, 404);

    const updated = await requestJson(baseUrl, `/api/v2/addresses/${second.body.data.id}`, {
      method: "PATCH", token: firstUser.token,
      body: { ...addressBody({ city: "Oakland", is_default: true }), expected_version: second.body.data.version }
    });
    assert.equal(updated.response.status, 200);
    const stale = await requestJson(baseUrl, `/api/v2/addresses/${second.body.data.id}`, {
      method: "PATCH", token: firstUser.token,
      body: { ...addressBody(), expected_version: second.body.data.version }
    });
    assert.equal(stale.response.status, 409);

    const removed = await requestJson(baseUrl, `/api/v2/addresses/${second.body.data.id}`, {
      method: "DELETE", token: firstUser.token, version: updated.body.data.version
    });
    assert.equal(removed.response.status, 200);
    const afterDelete = await requestJson(baseUrl, "/api/v2/addresses", { token: firstUser.token });
    assert.equal(afterDelete.body.data.length, 1);
    assert.equal(afterDelete.body.data[0].is_default, true);
    assert.ok([...repositories.account.addresses.values()].every((entry) => entry.normalizedHash.length === 64));
    assert.equal(JSON.stringify(repositories.audit.logs).includes("200 Pine Street"), false);
  } finally { server.close(); }
});

test("password change revokes sessions and all trusted devices", async () => {
  const { server, baseUrl, repositories } = createAccountTestApp();
  try {
    const user = await registerVerifiedUser(baseUrl, "password@example.com");
    const changed = await requestJson(baseUrl, "/api/v2/account/password", {
      method: "POST", token: user.token,
      body: { expected_version: 1, current_password: "CorrectHorse123", new_password: "NewCorrectHorse456" }
    });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.data.sessions_revoked, true);
    const after = await requestJson(baseUrl, "/api/v2/account", { token: user.token });
    assert.equal(after.response.status, 401);
    assert.ok([...repositories.auth.devices.values()].every((device) => device.trustRevokedAt));
  } finally { server.close(); }
});

test("account deletion is blocked by obligations then queued and anonymized asynchronously", async () => {
  const blockedApp = createAccountTestApp({ blockers: { wallet_balance: true, active_parcels: true } });
  try {
    const user = await registerVerifiedUser(blockedApp.baseUrl, "blocked-delete@example.com");
    const blocked = await requestJson(blockedApp.baseUrl, "/api/v2/account/deletion-requests", {
      method: "POST", token: user.token, body: {}
    });
    assert.equal(blocked.response.status, 422);
    assert.equal(blocked.body.error.code, "ACCOUNT_DELETION_BLOCKED");
    assert.equal(blocked.body.error.details.blockers.wallet_balance, true);
    assert.equal(blocked.body.error.details.blockers.active_parcels, true);
  } finally { blockedApp.server.close(); }

  const eligibleApp = createAccountTestApp();
  try {
    const user = await registerVerifiedUser(eligibleApp.baseUrl, "delete@example.com");
    const queued = await requestJson(eligibleApp.baseUrl, "/api/v2/account/deletion-requests", {
      method: "POST", token: user.token, body: {}
    });
    assert.equal(queued.response.status, 202);
    assert.equal(queued.body.data.deletion_request.status, "pending");
    assert.equal((await requestJson(eligibleApp.baseUrl, "/api/v2/account", { token: user.token })).response.status, 401);
    const processed = await eligibleApp.repositories.account.processNextDeletion();
    assert.equal(processed.status, "completed");
    const rawUser = eligibleApp.repositories.auth.users.get(user.user.id);
    assert.equal(rawUser.status, "banned");
    assert.ok(rawUser.anonymizedAt);
    assert.equal(rawUser.email.endsWith("@anonymous.invalid"), true);
  } finally { eligibleApp.server.close(); }
});

function addressBody(overrides = {}) {
  return {
    recipient_name: "Buyer One", phone: "+14155550123", country_code: "US",
    region: "CA", city: "San Francisco", postal_code: "94105",
    line1: "100 Market Street", line2: "", is_default: false, ...overrides
  };
}
