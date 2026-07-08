import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { createMemoryStorageAdapter } from "../src/storage/storage-adapter.js";
import { signPrivateObjectUrl } from "../src/storage/signed-url.js";
import { calculateStorageDeadline } from "../src/warehouse/storage-deadline.js";
import { MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";
import { MemoryWarehouseRepository } from "./helpers/memory-warehouse-repository.js";

function createWarehouseTestApp() {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    STORAGE_DRIVER: "memory",
    STORAGE_SIGNING_SECRET: "test-storage-signing-secret"
  });
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    core: new MemoryCoreRepository(),
    warehouse: new MemoryWarehouseRepository()
  };
  const storage = createMemoryStorageAdapter();
  const app = createApp({ env, repositories, storage });
  const server = app.listen(0);
  return {
    server,
    repositories,
    storage,
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

async function createAdmin(repository, permissions = ["warehouse:write"]) {
  await repository.createAdminUser({
    email: "warehouse@example.com",
    emailNormalized: normalizeEmail("warehouse@example.com"),
    passwordHash: await hashPassword("AdminPass123"),
    roles: ["warehouse"],
    permissions
  });
}

async function loginAdmin(baseUrl) {
  const result = await requestJson(baseUrl, "/admin/auth/login", {
    method: "POST",
    body: { email: "warehouse@example.com", password: "AdminPass123" }
  });
  assert.equal(result.response.status, 200);
  return result.body.session.access_token;
}

function photoBatch(count = 3, overrides = {}) {
  const body = Buffer.from("tiny image");
  return Array.from({ length: count }, (_, index) => ({
    file_name: `qc-${index + 1}.jpg`,
    content_type: "image/jpeg",
    size_bytes: body.length,
    data_base64: body.toString("base64"),
    ...overrides
  }));
}

test("storage deadline and signed URL helper are stable and private", () => {
  const deadline = calculateStorageDeadline("2026-01-01T00:00:00.000Z", 90, new Date("2026-01-31T00:00:00.000Z"));
  assert.equal(deadline.freeUntil, "2026-04-01T00:00:00.000Z");
  assert.equal(deadline.daysLeft, 60);

  const signed = signPrivateObjectUrl({
    key: "qc/user/item/01.jpg",
    baseUrl: "http://127.0.0.1:3000",
    secret: "test-storage-signing-secret",
    expiresInSeconds: 900,
    now: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.match(signed, /\/storage\/private\//);
  assert.doesNotMatch(signed, /bucket/);
  assert.match(signed, /signature=/);
});

test("admin receive is permission protected and idempotent", async () => {
  const { server, baseUrl, repositories } = createWarehouseTestApp();
  try {
    const { user } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["warehouse:write"]);
    const adminToken = await loginAdmin(baseUrl);
    const order = repositories.warehouse.seedReceivableOrder({ userId: user.id });

    const noToken = await requestJson(baseUrl, `/admin/warehouse/items/${order.purchaseOrderId}/receive`, {
      method: "POST"
    });
    assert.equal(noToken.response.status, 401);

    const receive = await requestJson(baseUrl, `/admin/warehouse/items/${order.purchaseOrderId}/receive`, {
      method: "POST",
      token: adminToken,
      body: { storage_location: "A1-02" }
    });
    assert.equal(receive.response.status, 201);
    assert.equal(receive.body.warehouse_item.storage_location, "A1-02");

    const repeat = await requestJson(baseUrl, `/admin/warehouse/items/${order.haulItemId}/receive`, {
      method: "POST",
      token: adminToken,
      body: {}
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);
  } finally {
    server.close();
  }
});

test("weight and QC photo upload validate inputs and create signed user QC view", async () => {
  const { server, baseUrl, repositories, storage } = createWarehouseTestApp();
  try {
    const { token, user } = await registerUser(baseUrl);
    await createAdmin(repositories.auth, ["warehouse:write"]);
    const adminToken = await loginAdmin(baseUrl);
    const order = repositories.warehouse.seedReceivableOrder({ userId: user.id });
    const receive = await requestJson(baseUrl, `/admin/warehouse/items/${order.purchaseOrderId}/receive`, {
      method: "POST",
      token: adminToken,
      body: { received_at: new Date().toISOString() }
    });
    const warehouseItemId = receive.body.warehouse_item.id;

    const badWeight = await requestJson(baseUrl, `/admin/warehouse/items/${warehouseItemId}/weight`, {
      method: "PATCH",
      token: adminToken,
      body: { weight_grams: 0 }
    });
    assert.equal(badWeight.response.status, 400);

    const weight = await requestJson(baseUrl, `/admin/warehouse/items/${warehouseItemId}/weight`, {
      method: "PATCH",
      token: adminToken,
      body: { weight_kg: 1.25 }
    });
    assert.equal(weight.response.status, 200);
    assert.equal(weight.body.warehouse_item.weight_grams, 1250);

    const tooFewPhotos = await requestJson(baseUrl, `/admin/qc/items/${warehouseItemId}/photos`, {
      method: "POST",
      token: adminToken,
      body: { photos: photoBatch(2) }
    });
    assert.equal(tooFewPhotos.response.status, 400);

    const upload = await requestJson(baseUrl, `/admin/qc/items/${warehouseItemId}/photos`, {
      method: "POST",
      token: adminToken,
      body: { photos: photoBatch(3) }
    });
    assert.equal(upload.response.status, 201);
    assert.equal(upload.body.photos.length, 3);
    assert.equal(storage.objects.size, 3);

    const qc = await requestJson(baseUrl, "/qc/items", { token });
    assert.equal(qc.response.status, 200);
    assert.equal(qc.body.items.length, 1);
    assert.equal(qc.body.items[0].photos.length, 3);
    assert.match(qc.body.items[0].photos[0].signed_url, /signature=/);
    assert.ok(qc.body.items[0].warehouse_item.storage.days_left >= 89);

    const photoUrl = new URL(qc.body.items[0].photos[0].signed_url);
    const photoResponse = await fetch(`${baseUrl}${photoUrl.pathname}${photoUrl.search}`);
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(await photoResponse.text(), "tiny image");
  } finally {
    server.close();
  }
});

test("QC approve requires photos and weight, syncs ready_to_ship, and blocks other users", async () => {
  const { server, baseUrl, repositories } = createWarehouseTestApp();
  try {
    const { token, user } = await registerUser(baseUrl, "buyer@example.com");
    const other = await registerUser(baseUrl, "other@example.com");
    await createAdmin(repositories.auth, ["warehouse:write"]);
    const adminToken = await loginAdmin(baseUrl);
    const order = repositories.warehouse.seedReceivableOrder({ userId: user.id });
    const receive = await requestJson(baseUrl, `/admin/warehouse/items/${order.purchaseOrderId}/receive`, {
      method: "POST",
      token: adminToken,
      body: {}
    });
    const warehouseItemId = receive.body.warehouse_item.id;

    const approveNoPhotos = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/approve`, {
      method: "POST",
      token
    });
    assert.equal(approveNoPhotos.response.status, 409);

    await requestJson(baseUrl, `/admin/qc/items/${warehouseItemId}/photos`, {
      method: "POST",
      token: adminToken,
      body: { photos: photoBatch(3) }
    });

    const approveNoWeight = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/approve`, {
      method: "POST",
      token
    });
    assert.equal(approveNoWeight.response.status, 409);

    await requestJson(baseUrl, `/admin/warehouse/items/${warehouseItemId}/weight`, {
      method: "PATCH",
      token: adminToken,
      body: { weight_grams: 900 }
    });

    const otherApprove = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/approve`, {
      method: "POST",
      token: other.token
    });
    assert.equal(otherApprove.response.status, 404);

    const approve = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/approve`, {
      method: "POST",
      token
    });
    assert.equal(approve.response.status, 200);
    assert.equal(approve.body.item.warehouse_item.status, "ready_to_ship");
    assert.equal(repositories.warehouse.haulItemStatuses.get(order.haulItemId), "ready_to_ship");
  } finally {
    server.close();
  }
});

test("extra photo request is duplicate-safe and storage status is scoped", async () => {
  const { server, baseUrl, repositories } = createWarehouseTestApp();
  try {
    const { token, user } = await registerUser(baseUrl, "buyer@example.com");
    const other = await registerUser(baseUrl, "other@example.com");
    await createAdmin(repositories.auth, ["warehouse:write"]);
    const adminToken = await loginAdmin(baseUrl);
    const order = repositories.warehouse.seedReceivableOrder({ userId: user.id });
    const receivedAt = new Date().toISOString();
    const receive = await requestJson(baseUrl, `/admin/warehouse/items/${order.purchaseOrderId}/receive`, {
      method: "POST",
      token: adminToken,
      body: { received_at: receivedAt }
    });
    const warehouseItemId = receive.body.warehouse_item.id;

    const request = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/extra-photo`, {
      method: "POST",
      token,
      body: { reason: "Need tag close-up" }
    });
    assert.equal(request.response.status, 201);

    const repeat = await requestJson(baseUrl, `/qc/items/${warehouseItemId}/extra-photo`, {
      method: "POST",
      token,
      body: { reason: "Again" }
    });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.existing, true);

    const storage = await requestJson(baseUrl, `/warehouse/items/${warehouseItemId}/storage`, { token });
    assert.equal(storage.response.status, 200);
    assert.equal(storage.body.storage.free_until, calculateStorageDeadline(receivedAt).freeUntil);
    assert.ok(storage.body.storage.days_left >= 89);

    const otherStorage = await requestJson(baseUrl, `/warehouse/items/${warehouseItemId}/storage`, {
      token: other.token
    });
    assert.equal(otherStorage.response.status, 404);
  } finally {
    server.close();
  }
});
