import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { normalizeEmail } from "../src/auth/input.js";
import { parseEnv } from "../src/config/env.js";
import { hashPassword } from "../src/security/password.js";
import { MemoryAdminRepository } from "./helpers/memory-admin-repository.js";
import { loginAdminWithTotp, MemoryAuditRepository, MemoryAuthRepository } from "./helpers/memory-auth-repository.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";
import { MemoryShippingRepository } from "./helpers/memory-shipping-repository.js";
import { MemoryWalletRepository } from "./helpers/memory-wallet-repository.js";
import { MemoryWarehouseRepository } from "./helpers/memory-warehouse-repository.js";

function createAdminConsoleTestApp() {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false",
    STORAGE_DRIVER: "memory"
  });
  const shippingRepository = new MemoryShippingRepository();
  const repositories = {
    auth: new MemoryAuthRepository(),
    audit: new MemoryAuditRepository(),
    core: new MemoryCoreRepository(),
    warehouse: new MemoryWarehouseRepository(),
    shipping: shippingRepository,
    wallet: new MemoryWalletRepository({ shippingRepository }),
    admin: new MemoryAdminRepository()
  };
  const app = createApp({ env, repositories });
  const server = app.listen(0);
  return {
    server,
    repositories,
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

async function createAdmin(repository, { email, roles = [], permissions = [] }) {
  await repository.createAdminUser({
    email,
    emailNormalized: normalizeEmail(email),
    passwordHash: await hashPassword("AdminPass123"),
    roles,
    permissions
  });
}

async function loginAdmin(baseUrl, email) {
  return (await loginAdminWithTotp(baseUrl, email)).session.access_token;
}

test("admin overview and order queue are permission scoped and paginated", async () => {
  const { server, baseUrl, repositories } = createAdminConsoleTestApp();
  try {
    repositories.admin.seedOrder({ title: "Submitted order", status: "submitted", createdAt: "2026-01-03T00:00:00.000Z" });
    repositories.admin.seedOrder({ title: "Exception order", status: "exception", exception: "seller cancelled", createdAt: "2026-01-02T00:00:00.000Z" });
    repositories.admin.seedWarehouseItem({ status: "qc_ready" });
    repositories.admin.seedParcel({ status: "shipping_due" });
    repositories.admin.seedPolicy({ policyType: "qc", status: "published" });

    await createAdmin(repositories.auth, {
      email: "buyerops@example.com",
      roles: ["procurement_agent"],
      permissions: ["orders:read", "orders:write"]
    });
    const token = await loginAdmin(baseUrl, "buyerops@example.com");

    const noToken = await requestJson(baseUrl, "/admin/orders");
    assert.equal(noToken.response.status, 401);

    const overview = await requestJson(baseUrl, "/admin/overview", { token });
    assert.equal(overview.response.status, 200);
    assert.deepEqual(overview.body.overview.visible, ["orders"]);
    assert.equal(overview.body.overview.counts.orders.total, 2);
    assert.equal(overview.body.overview.counts.orders.exceptions, 1);
    assert.equal(overview.body.overview.counts.warehouse, undefined);

    const list = await requestJson(baseUrl, "/admin/orders?status=submitted&limit=1&offset=0", { token });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.orders.length, 1);
    assert.equal(list.body.orders[0].title, "Submitted order");
    assert.equal(list.body.orders[0].internal_notes, undefined);
    assert.equal(list.body.pagination.total, 1);
    assert.equal(list.body.pagination.has_more, false);

    const invalidStatus = await requestJson(baseUrl, "/admin/orders?status=ready_to_ship", { token });
    assert.equal(invalidStatus.response.status, 400);

    const deniedWarehouse = await requestJson(baseUrl, "/admin/warehouse/items", { token });
    assert.equal(deniedWarehouse.response.status, 403);
  } finally {
    server.close();
  }
});

test("admin order status and exception updates enforce transitions and audit writes", async () => {
  const { server, baseUrl, repositories } = createAdminConsoleTestApp();
  try {
    const order = repositories.admin.seedOrder({ status: "submitted" });
    await createAdmin(repositories.auth, {
      email: "procurement@example.com",
      roles: ["procurement_agent"],
      permissions: ["orders:read", "orders:write"]
    });
    await createAdmin(repositories.auth, {
      email: "support@example.com",
      roles: ["support_agent"],
      permissions: ["support:write"]
    });
    const procurementToken = await loginAdmin(baseUrl, "procurement@example.com");
    const supportToken = await loginAdmin(baseUrl, "support@example.com");

    const advance = await requestJson(baseUrl, `/admin/orders/${order.id}/status`, {
      method: "PATCH",
      token: procurementToken,
      body: { status: "purchasing", external_order_no: "TB123", reason: "buyer paid" }
    });
    assert.equal(advance.response.status, 200);
    assert.equal(advance.body.order.status, "purchasing");
    assert.equal(advance.body.order.external_order_no, "TB123");
    assert.equal(repositories.admin.orderHistory.length, 1);
    assert.ok(repositories.audit.logs.some((log) => log.action === "order.status.update"));

    const illegal = await requestJson(baseUrl, `/admin/orders/${order.id}/status`, {
      method: "PATCH",
      token: procurementToken,
      body: { status: "qc_ready" }
    });
    assert.equal(illegal.response.status, 409);

    const missingException = await requestJson(baseUrl, `/admin/orders/${order.id}/exception`, {
      method: "PATCH",
      token: supportToken,
      body: {}
    });
    assert.equal(missingException.response.status, 400);

    const exception = await requestJson(baseUrl, `/admin/orders/${order.id}/exception`, {
      method: "PATCH",
      token: supportToken,
      body: { reason: "seller refund pending" }
    });
    assert.equal(exception.response.status, 200);
    assert.equal(exception.body.order.status, "exception");
    assert.equal(exception.body.order.exception, "seller refund pending");
    assert.ok(repositories.audit.logs.some((log) => log.action === "order.exception.update" && log.metadata.risk_case_suggested));

    const deniedStatus = await requestJson(baseUrl, `/admin/orders/${order.id}/status`, {
      method: "PATCH",
      token: supportToken,
      body: { status: "cancelled" }
    });
    assert.equal(deniedStatus.response.status, 403);
  } finally {
    server.close();
  }
});

test("warehouse, parcel, and policy admin APIs enforce role boundaries", async () => {
  const { server, baseUrl, repositories } = createAdminConsoleTestApp();
  try {
    repositories.admin.seedWarehouseItem({ title: "Ready item", status: "ready_to_ship", photoCount: 4 });
    repositories.admin.seedWarehouseItem({ title: "QC item", status: "qc_ready", photoCount: 3 });
    const parcel = repositories.admin.seedParcel({ status: "shipping_due", finalFeeCents: 2400, paymentStatus: "requires_payment" });
    const policy = repositories.admin.seedPolicy({ policyType: "storage", status: "draft", version: 2 });

    await createAdmin(repositories.auth, {
      email: "warehouse@example.com",
      roles: ["warehouse_operator"],
      permissions: ["warehouse:read"]
    });
    await createAdmin(repositories.auth, {
      email: "shipper@example.com",
      roles: ["warehouse_operator"],
      permissions: ["shipping:read"]
    });
    await createAdmin(repositories.auth, {
      email: "support2@example.com",
      roles: ["support_agent"],
      permissions: ["support:read"]
    });
    await createAdmin(repositories.auth, {
      email: "ops@example.com",
      roles: ["campaign_operator"],
      permissions: ["ops:policy:write"]
    });

    const warehouseToken = await loginAdmin(baseUrl, "warehouse@example.com");
    const shippingToken = await loginAdmin(baseUrl, "shipper@example.com");
    const supportToken = await loginAdmin(baseUrl, "support2@example.com");
    const opsToken = await loginAdmin(baseUrl, "ops@example.com");

    const warehouse = await requestJson(baseUrl, "/admin/warehouse/items?status=ready_to_ship", { token: warehouseToken });
    assert.equal(warehouse.response.status, 200);
    assert.equal(warehouse.body.items.length, 1);
    assert.equal(warehouse.body.items[0].photo_count, 4);

    const deniedOrders = await requestJson(baseUrl, "/admin/orders", { token: warehouseToken });
    assert.equal(deniedOrders.response.status, 403);

    const shippingParcels = await requestJson(baseUrl, "/admin/parcels", { token: shippingToken });
    assert.equal(shippingParcels.response.status, 200);
    assert.equal(shippingParcels.body.parcels[0].final_fee_cents, 2400);
    assert.equal(shippingParcels.body.redacted, false);

    const supportParcels = await requestJson(baseUrl, "/admin/parcels", { token: supportToken });
    assert.equal(supportParcels.response.status, 400);
    const searchedSupportParcels = await requestJson(baseUrl, `/admin/parcels?id=${parcel.id}`, { token: supportToken });
    assert.equal(searchedSupportParcels.response.status, 200);
    assert.equal(searchedSupportParcels.body.parcels[0].final_fee_cents, undefined);
    assert.equal(searchedSupportParcels.body.parcels[0].payment_status, undefined);
    assert.equal(searchedSupportParcels.body.redacted, true);
    const sensitiveQueryAudit = repositories.audit.logs.find((log) => log.action === "admin.sensitive_query");
    assert.deepEqual(sensitiveQueryAudit.metadata.filter_keys, ["id"]);
    assert.equal(JSON.stringify(sensitiveQueryAudit.metadata).includes(parcel.id), false);

    const policies = await requestJson(baseUrl, "/admin/policies?status=draft", { token: opsToken });
    assert.equal(policies.response.status, 200);
    assert.equal(policies.body.policies.length, 1);
    assert.equal(policies.body.policies[0].policy_type, "storage");

    const policyUpdate = await requestJson(baseUrl, `/admin/policies/${policy.id}`, {
      method: "PATCH",
      token: opsToken,
      body: { title: "Storage policy", body: "90 days free storage after warehouse arrival.", status: "published" }
    });
    assert.equal(policyUpdate.response.status, 200);
    assert.equal(policyUpdate.body.policy.version, 3);
    assert.equal(policyUpdate.body.policy.status, "published");
    assert.ok(repositories.audit.logs.some((log) => log.action === "policy.update"));

    const policyDenied = await requestJson(baseUrl, "/admin/policies", { token: shippingToken });
    assert.equal(policyDenied.response.status, 403);
  } finally {
    server.close();
  }
});
