import { randomUUID } from "node:crypto";
import {
  normalizeAdminOrder,
  normalizeAdminParcel,
  normalizeAdminPolicy,
  normalizeAdminWarehouseItem
} from "../../src/admin/admin-repository.js";

export class MemoryAdminRepository {
  constructor() {
    this.orders = new Map();
    this.warehouseItems = new Map();
    this.parcels = new Map();
    this.policies = new Map();
    this.orderHistory = [];
  }

  seedOrder(input = {}) {
    const now = input.createdAt || new Date().toISOString();
    const order = normalizeAdminOrder({
      id: input.id || randomUUID(),
      userId: input.userId || randomUUID(),
      userEmail: input.userEmail || "buyer@example.com",
      haulItemId: input.haulItemId || randomUUID(),
      title: input.title || "Taobao hoodie",
      spec: input.spec || "Black / M",
      priceCents: input.priceCents ?? 4200,
      currency: input.currency || "USD",
      quantity: input.quantity || 1,
      sourcePlatform: input.sourcePlatform || "Taobao",
      sourceDomain: input.sourceDomain || "item.taobao.com",
      status: input.status || "submitted",
      haulStatus: input.haulStatus || "purchasing",
      exception: input.exception || "",
      externalOrderNo: input.externalOrderNo || "",
      createdAt: now,
      updatedAt: now
    });
    this.orders.set(order.id, order);
    return clone(order);
  }

  seedWarehouseItem(input = {}) {
    const now = input.createdAt || new Date().toISOString();
    const item = normalizeAdminWarehouseItem({
      id: input.id || randomUUID(),
      userId: input.userId || randomUUID(),
      userEmail: input.userEmail || "buyer@example.com",
      purchaseOrderId: input.purchaseOrderId || randomUUID(),
      haulItemId: input.haulItemId || randomUUID(),
      title: input.title || "Warehouse hoodie",
      spec: input.spec || "Black / M",
      status: input.status || "qc_ready",
      haulStatus: input.haulStatus || "qc_ready",
      orderStatus: input.orderStatus || "arrived",
      storageLocation: input.storageLocation || "A1-02",
      weightGrams: input.weightGrams ?? 900,
      freeStorageDays: input.freeStorageDays || 90,
      photoCount: input.photoCount ?? 3,
      receivedAt: input.receivedAt || now,
      createdAt: now,
      updatedAt: now
    });
    this.warehouseItems.set(item.id, item);
    return clone(item);
  }

  seedParcel(input = {}) {
    const now = input.createdAt || new Date().toISOString();
    const parcel = normalizeAdminParcel({
      id: input.id || randomUUID(),
      userId: input.userId || randomUUID(),
      userEmail: input.userEmail || "buyer@example.com",
      status: input.status || "shipping_due",
      destinationCountry: input.destinationCountry || "United States",
      recipientName: input.recipientName || "Buyer One",
      shippingLineId: input.shippingLineId || randomUUID(),
      shippingLineCode: input.shippingLineCode || "US-STANDARD",
      shippingLineName: input.shippingLineName || "US Standard",
      itemCount: input.itemCount ?? 2,
      chargeableWeightGrams: input.chargeableWeightGrams ?? 1300,
      finalFeeCents: input.finalFeeCents ?? 1899,
      currency: input.currency || "USD",
      trackingNumber: input.trackingNumber || "",
      paymentStatus: input.paymentStatus || "requires_payment",
      paymentAmountCents: input.paymentAmountCents ?? 1899,
      paymentProvider: input.paymentProvider || "mock",
      submittedAt: input.submittedAt || now,
      paidAt: input.paidAt || null,
      shippedAt: input.shippedAt || null,
      deliveredAt: input.deliveredAt || null,
      createdAt: now,
      updatedAt: now
    });
    this.parcels.set(parcel.id, parcel);
    return clone(parcel);
  }

  seedPolicy(input = {}) {
    const now = input.createdAt || new Date().toISOString();
    const policy = normalizeAdminPolicy({
      id: input.id || randomUUID(),
      policyType: input.policyType || "qc",
      title: input.title || "QC",
      body: input.body || "QC photos help users inspect visible details.",
      status: input.status || "published",
      version: input.version || 1,
      publishedAt: input.publishedAt || now,
      createdAt: now,
      updatedAt: now
    });
    this.policies.set(policy.id, policy);
    return clone(policy);
  }

  async getOverviewCounts() {
    return {
      orders: countStatuses(this.orders.values(), ["submitted", "purchasing", "seller_shipped", "arrived", "qc_ready", "cancelled"], {
        exceptions: (order) => order.status === "exception"
      }),
      warehouse: countStatuses(this.warehouseItems.values(), ["received", "qc_pending", "qc_ready", "extra_photo_requested", "ready_to_ship"]),
      parcels: countStatuses(this.parcels.values(), ["draft", "shipping_due", "payment_pending", "paid", "processing", "dispatched", "in_transit", "delivered", "cancelled"]),
      policies: countStatuses(this.policies.values(), ["draft", "published", "archived"])
    };
  }

  async listOrders({ status = "", limit = 25, offset = 0, id = "", userId = "", email = "", orderNo = "" } = {}) {
    return page(
      Array.from(this.orders.values()).filter((order) => matchesScope(order, { status, id, userId, email, reference: orderNo, referenceValue: order.externalOrderNo })),
      limit,
      offset
    );
  }

  async findOrderById(orderId) {
    return clone(this.orders.get(orderId));
  }

  async updateOrderStatus(input) {
    const order = this.orders.get(input.orderId);
    if (!order) return null;
    if (order.status !== input.status) {
      this.orderHistory.push({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: input.status,
        adminUserId: input.adminUserId,
        reason: input.reason || "admin_status_update"
      });
    }
    order.status = input.status;
    order.haulStatus = haulStatusForOrder(input.status, order.haulStatus);
    if (input.externalOrderNo) order.externalOrderNo = input.externalOrderNo;
    if (input.status !== "exception") order.exception = "";
    order.updatedAt = new Date().toISOString();
    return clone(order);
  }

  async updateOrderException(input) {
    const order = this.orders.get(input.orderId);
    if (!order) return null;
    if (order.status !== "exception") {
      this.orderHistory.push({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "exception",
        adminUserId: input.adminUserId,
        reason: input.exception
      });
    }
    order.status = "exception";
    order.exception = input.exception;
    order.updatedAt = new Date().toISOString();
    return clone(order);
  }

  async listWarehouseItems({ status = "", limit = 25, offset = 0, id = "", userId = "", email = "" } = {}) {
    return page(
      Array.from(this.warehouseItems.values()).filter((item) => matchesScope(item, { status, id, userId, email })),
      limit,
      offset
    );
  }

  async listParcels({ status = "", limit = 25, offset = 0, id = "", userId = "", email = "", parcelNo = "" } = {}) {
    return page(
      Array.from(this.parcels.values()).filter((parcel) => matchesScope(parcel, { status, id, userId, email, reference: parcelNo, referenceValue: parcel.trackingNumber })),
      limit,
      offset
    );
  }

  async listPolicies({ status = "", limit = 50, offset = 0 } = {}) {
    return page(
      Array.from(this.policies.values()).filter((policy) => !status || policy.status === status),
      limit,
      offset,
      (a, b) => a.policyType.localeCompare(b.policyType)
    );
  }

  async updatePolicy(input) {
    const policy = this.policies.get(input.policyId);
    if (!policy) return null;
    if (input.title !== undefined) policy.title = input.title;
    if (input.body !== undefined) policy.body = input.body;
    if (input.status !== undefined) policy.status = input.status;
    if (policy.status === "published" && !policy.publishedAt) policy.publishedAt = new Date().toISOString();
    policy.version += 1;
    policy.updatedAt = new Date().toISOString();
    return clone(policy);
  }
}

function matchesScope(item, filters) {
  return (!filters.status || item.status === filters.status)
    && (!filters.id || item.id === filters.id)
    && (!filters.userId || item.userId === filters.userId)
    && (!filters.email || item.userEmail.toLowerCase() === filters.email.toLowerCase())
    && (!filters.reference || filters.referenceValue === filters.reference);
}

function page(items, limit, offset, sorter = sortDesc) {
  const sorted = [...items].sort(sorter);
  return {
    items: sorted.slice(offset, offset + limit).map(clone),
    total: sorted.length
  };
}

function countStatuses(items, statuses, extras = {}) {
  const result = { total: 0 };
  for (const status of statuses) result[status] = 0;
  for (const name of Object.keys(extras)) result[name] = 0;
  for (const item of items) {
    result.total += 1;
    if (Object.hasOwn(result, item.status)) result[item.status] += 1;
    for (const [name, predicate] of Object.entries(extras)) {
      if (predicate(item)) result[name] += 1;
    }
  }
  return result;
}

function haulStatusForOrder(status, fallback) {
  return {
    submitted: "purchasing",
    purchasing: "purchasing",
    seller_shipped: "seller_shipped",
    arrived: "arrived",
    qc_ready: "qc_ready",
    cancelled: "cancelled"
  }[status] || fallback;
}

function sortDesc(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
