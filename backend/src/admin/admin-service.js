import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText, requiredText, validateStatus } from "../core/core-input.js";
import { hasPermission } from "../rbac/permissions.js";

const ORDER_QUEUE_PERMISSIONS = Object.freeze(["orders:read", "orders:write", "support:read"]);
const ORDER_EXCEPTION_PERMISSIONS = Object.freeze(["orders:write", "support:write"]);
const WAREHOUSE_QUEUE_PERMISSIONS = Object.freeze(["warehouse:read", "warehouse:write"]);
const PARCEL_QUEUE_PERMISSIONS = Object.freeze(["shipping:read", "shipping:write", "support:read"]);
const PARCEL_FINANCIAL_PERMISSIONS = Object.freeze(["shipping:read", "shipping:write", "finance:wallet:write"]);
const POLICY_PERMISSIONS = Object.freeze(["ops:policy:write"]);

export const ADMIN_ORDER_STATUSES = Object.freeze([
  "submitted",
  "purchasing",
  "seller_shipped",
  "arrived",
  "qc_ready",
  "cancelled",
  "exception"
]);
const WAREHOUSE_STATUSES = Object.freeze(["received", "qc_pending", "qc_ready", "extra_photo_requested", "approved", "ready_to_ship"]);
const PARCEL_STATUSES = Object.freeze(["draft", "shipping_due", "payment_pending", "paid", "processing", "dispatched", "in_transit", "delivered", "cancelled"]);
const POLICY_STATUSES = Object.freeze(["draft", "published", "archived"]);

const ORDER_TRANSITIONS = Object.freeze({
  submitted: ["purchasing", "cancelled"],
  purchasing: ["seller_shipped", "cancelled"],
  seller_shipped: ["arrived", "cancelled"],
  arrived: ["qc_ready", "cancelled"],
  qc_ready: ["cancelled"],
  exception: ["purchasing", "cancelled"],
  cancelled: []
});

export function createAdminService({ repository, auditLogger = null } = {}) {
  return {
    async getOverview(adminUser, permissions = []) {
      const visibility = {
        orders: hasAnyPermission(permissions, ORDER_QUEUE_PERMISSIONS),
        warehouse: hasAnyPermission(permissions, WAREHOUSE_QUEUE_PERMISSIONS),
        parcels: hasAnyPermission(permissions, PARCEL_QUEUE_PERMISSIONS),
        policies: hasAnyPermission(permissions, POLICY_PERMISSIONS)
      };
      const counts = await repository.getOverviewCounts();
      return {
        overview: {
          admin_user_id: adminUser.id,
          visible: Object.entries(visibility)
            .filter(([, allowed]) => allowed)
            .map(([name]) => name),
          counts: Object.fromEntries(
            Object.entries(counts)
              .filter(([domain]) => visibility[domain])
              .map(([domain, value]) => [domain, value])
          )
        }
      };
    },

    async listOrders(query = {}, dataScope = {}, adminUser = null, requestMeta = {}) {
      const page = parsePagination(query, { defaultLimit: 25, maxLimit: 100 });
      const status = validateStatus(query.status, ADMIN_ORDER_STATUSES);
      await auditScopedQuery(auditLogger, adminUser, dataScope, "purchase_order", requestMeta);
      const result = await repository.listOrders({ status, ...page, ...scopeFilters(dataScope) });
      return {
        orders: result.items.map(publicAdminOrder),
        pagination: pagination(result.total, page)
      };
    },

    async updateOrderStatus(adminUser, orderId, input = {}, requestMeta = {}) {
      const status = requiredStatus(input.status, ADMIN_ORDER_STATUSES);
      if (status === "exception") {
        throw badRequest("Use the exception endpoint to mark order exceptions.", { field: "status" });
      }
      const order = await repository.findOrderById(orderId);
      if (!order) throw notFound("Order not found.");
      if (status === order.status) {
        return { order: publicAdminOrder(order), existing: true };
      }
      if (!ORDER_TRANSITIONS[order.status]?.includes(status)) {
        throw conflict(`Cannot move order from ${order.status} to ${status}.`);
      }

      const updated = await repository.updateOrderStatus({
        orderId: order.id,
        status,
        adminUserId: adminUser.id,
        externalOrderNo: optionalText(input.external_order_no ?? input.externalOrderNo, "external_order_no", 120),
        reason: optionalText(input.reason, "reason", 500) || "admin_status_update"
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "order.status.update",
        resourceType: "purchase_order",
        resourceId: order.id,
        metadata: { from_status: order.status, to_status: status },
        requestId: requestMeta.requestId,
        ipHash: requestMeta.ipHash
      }, { critical: true });
      return { order: publicAdminOrder(updated), existing: false };
    },

    async updateOrderException(adminUser, permissions = [], orderId, input = {}, requestMeta = {}) {
      if (!hasAnyPermission(permissions, ORDER_EXCEPTION_PERMISSIONS)) {
        throw badRequest("Order exception updates require an order or support write permission.");
      }
      const exception = requiredText(input.exception ?? input.reason, "exception", 500);
      const order = await repository.findOrderById(orderId);
      if (!order) throw notFound("Order not found.");
      const updated = await repository.updateOrderException({
        orderId: order.id,
        adminUserId: adminUser.id,
        exception
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "order.exception.update",
        resourceType: "purchase_order",
        resourceId: order.id,
        metadata: {
          from_status: order.status,
          to_status: "exception",
          exception,
          risk_case_suggested: true
        },
        requestId: requestMeta.requestId,
        ipHash: requestMeta.ipHash
      }, { critical: true });
      return { order: publicAdminOrder(updated) };
    },

    async listWarehouseItems(query = {}, dataScope = {}, adminUser = null, requestMeta = {}) {
      const page = parsePagination(query, { defaultLimit: 25, maxLimit: 100 });
      const status = validateStatus(query.status, WAREHOUSE_STATUSES);
      await auditScopedQuery(auditLogger, adminUser, dataScope, "warehouse_item", requestMeta);
      const result = await repository.listWarehouseItems({ status, ...page, ...scopeFilters(dataScope) });
      return {
        items: result.items.map(publicAdminWarehouseItem),
        pagination: pagination(result.total, page)
      };
    },

    async listParcels(permissions = [], query = {}, dataScope = {}, adminUser = null, requestMeta = {}) {
      const page = parsePagination(query, { defaultLimit: 25, maxLimit: 100 });
      const status = validateStatus(query.status, PARCEL_STATUSES);
      const includeFinancials = hasAnyPermission(permissions, PARCEL_FINANCIAL_PERMISSIONS);
      await auditScopedQuery(auditLogger, adminUser, dataScope, "parcel", requestMeta);
      const result = await repository.listParcels({ status, ...page, ...scopeFilters(dataScope) });
      return {
        parcels: result.items.map((parcel) => publicAdminParcel(parcel, { includeFinancials })),
        pagination: pagination(result.total, page),
        redacted: !includeFinancials
      };
    },

    async listPolicies(query = {}) {
      const page = parsePagination(query, { defaultLimit: 50, maxLimit: 100 });
      const status = validateStatus(query.status, POLICY_STATUSES);
      const result = await repository.listPolicies({ status, ...page });
      return {
        policies: result.items.map(publicAdminPolicy),
        pagination: pagination(result.total, page)
      };
    },

    async updatePolicy(adminUser, policyId, input = {}, requestMeta = {}) {
      const patch = parsePolicyPatch(input);
      const updated = await repository.updatePolicy({ policyId, ...patch });
      if (!updated) throw notFound("Policy not found.");
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "policy.update",
        resourceType: "policy_page",
        resourceId: updated.id,
        metadata: { policy_type: updated.policyType, status: updated.status, version: updated.version },
        requestId: requestMeta.requestId,
        ipHash: requestMeta.ipHash
      }, { critical: true });
      return { policy: publicAdminPolicy(updated) };
    }
  };
}

function scopeFilters(dataScope = {}) {
  const search = dataScope.exactSearch || {};
  return {
    id: search.id || "",
    userId: search.user_id || "",
    email: search.email || "",
    orderNo: search.order_no || "",
    parcelNo: search.parcel_no || ""
  };
}

async function auditScopedQuery(auditLogger, adminUser, dataScope, resourceType, requestMeta) {
  const filterKeys = Object.keys(dataScope?.exactSearch || {});
  if (!adminUser || filterKeys.length === 0) return;
  await auditLogger?.write({
    actorType: "admin",
    actorAdminUserId: adminUser.id,
    action: "admin.sensitive_query",
    resourceType,
    metadata: { scope: dataScope.scope, filter_keys: filterKeys },
    requestId: requestMeta.requestId
  }, { critical: true });
}

export function publicAdminOrder(order) {
  return {
    id: order.id,
    user_id: order.userId,
    user_email: order.userEmail,
    haul_item_id: order.haulItemId,
    title: order.title,
    spec: order.spec,
    price_cents: order.priceCents,
    price: order.price,
    currency: order.currency,
    quantity: order.quantity,
    source_platform: order.sourcePlatform,
    source_domain: order.sourceDomain,
    status: order.status,
    haul_status: order.haulStatus,
    exception: order.exception,
    external_order_no: order.externalOrderNo,
    created_at: order.createdAt,
    updated_at: order.updatedAt
  };
}

export function publicAdminWarehouseItem(item) {
  return {
    id: item.id,
    user_id: item.userId,
    user_email: item.userEmail,
    purchase_order_id: item.purchaseOrderId,
    haul_item_id: item.haulItemId,
    title: item.title,
    spec: item.spec,
    status: item.status,
    haul_status: item.haulStatus,
    order_status: item.orderStatus,
    storage_location: item.storageLocation,
    weight_grams: item.weightGrams,
    weight_kg: item.weightGrams ? item.weightGrams / 1000 : null,
    free_storage_days: item.freeStorageDays,
    photo_count: item.photoCount,
    received_at: item.receivedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function publicAdminParcel(parcel, { includeFinancials = false } = {}) {
  const base = {
    id: parcel.id,
    user_id: parcel.userId,
    user_email: parcel.userEmail,
    status: parcel.status,
    destination_country: parcel.destinationCountry,
    recipient_name: parcel.recipientName,
    shipping_line_id: parcel.shippingLineId,
    shipping_line_code: parcel.shippingLineCode,
    shipping_line_name: parcel.shippingLineName,
    item_count: parcel.itemCount,
    chargeable_weight_grams: parcel.chargeableWeightGrams,
    currency: parcel.currency,
    tracking_number: parcel.trackingNumber,
    submitted_at: parcel.submittedAt,
    paid_at: parcel.paidAt,
    shipped_at: parcel.shippedAt,
    delivered_at: parcel.deliveredAt,
    created_at: parcel.createdAt,
    updated_at: parcel.updatedAt
  };
  if (!includeFinancials) return base;
  return {
    ...base,
    final_fee_cents: parcel.finalFeeCents,
    final_fee: parcel.finalFee,
    payment_status: parcel.paymentStatus,
    payment_amount_cents: parcel.paymentAmountCents,
    payment_amount: parcel.paymentAmount,
    payment_provider: parcel.paymentProvider
  };
}

export function publicAdminPolicy(policy) {
  return {
    id: policy.id,
    policy_type: policy.policyType,
    title: policy.title,
    body: policy.body,
    status: policy.status,
    version: policy.version,
    published_at: policy.publishedAt,
    created_at: policy.createdAt,
    updated_at: policy.updatedAt
  };
}

function parsePagination(query = {}, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const limit = parseBoundedInteger(query.limit, "limit", defaultLimit, 1, maxLimit);
  const offset = parseBoundedInteger(query.offset, "offset", 0, 0, 100000);
  return { limit, offset };
}

function parseBoundedInteger(value, field, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(`${field} is invalid.`, { field, min, max });
  }
  return number;
}

function pagination(total, { limit, offset }) {
  return {
    total,
    limit,
    offset,
    has_more: offset + limit < total
  };
}

function requiredStatus(value, allowed) {
  const status = validateStatus(value, allowed);
  if (!status) {
    throw badRequest("status is required.", { field: "status" });
  }
  return status;
}

function parsePolicyPatch(input = {}) {
  const patch = {
    title: input.title === undefined ? undefined : requiredText(input.title, "title", 160),
    body: input.body === undefined ? undefined : requiredText(input.body, "body", 5000),
    status: input.status === undefined ? undefined : requiredStatus(input.status, POLICY_STATUSES)
  };
  if (patch.title === undefined && patch.body === undefined && patch.status === undefined) {
    throw badRequest("At least one policy field is required.");
  }
  return patch;
}

function hasAnyPermission(permissions = [], required = []) {
  return required.some((permission) => hasPermission(permissions, permission));
}
