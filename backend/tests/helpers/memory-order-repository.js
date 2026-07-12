import { randomUUID } from "node:crypto";
import {
  normalizeConfirmation, normalizeException, normalizeExceptionEvent,
  normalizeHistory, normalizeItem, normalizeParent
} from "../../src/orders/order-repository.js";
import { statusColumn } from "../../src/orders/order-status.js";

// In-memory double for the order repository. createOrderWithItems mirrors the
// production transaction: it builds every row first and only commits the whole
// set at once, and rejects a duplicate submit key with 23505 like the unique
// index does.
export class MemoryOrderRepository {
  constructor() {
    this.parents = new Map();
    this.parentsBySubmit = new Map();
    this.items = new Map();
    this.history = [];
    this.confirmations = [];
    this.exceptions = new Map();
    this.exceptionEvents = [];
  }

  async createException(input) {
    const item = this.items.get(input.itemOrderId);
    if (!item) return { exception: null };
    if (item.exceptionStatus !== "none") {
      const error = new Error("An exception is already active on this item.");
      error.code = "ORDER_EXCEPTION_ACTIVE";
      throw error;
    }
    const now = new Date().toISOString();
    const exception = normalizeException({
      id: randomUUID(), item_order_id: input.itemOrderId, user_id: input.userId, type: input.type,
      status: "open", surcharge_cents: input.surchargeCents ?? null, currency: input.currency || "CNY",
      detail: input.detail || {}, resolution: "", deadline_at: input.deadlineAt,
      created_by_admin_id: input.createdByAdminId || null, resolved_at: null, created_at: now, updated_at: now
    });
    this.exceptions.set(exception.id, exception);
    item.exceptionStatus = input.exceptionStatus;
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: input.itemOrderId, field: "exception", from_status: "none",
      to_status: input.exceptionStatus, action: `raise_${input.type}`, reason: "", actor_type: "admin",
      actor_id: input.createdByAdminId || null, actor_role: "", idempotency_key: null,
      request_id: input.requestId || "", evidence: {}, created_at: now
    }));
    this.exceptionEvents.push(normalizeExceptionEvent({
      id: randomUUID(), exception_id: exception.id, action: "raised", detail: input.detail || {},
      actor_type: "admin", actor_id: input.createdByAdminId || null, created_at: now
    }));
    return { exception: clone(exception), item: clone(item) };
  }

  async findOpenExceptionByItem(itemId) {
    const ex = Array.from(this.exceptions.values()).find((e) => e.itemOrderId === itemId && e.status === "open");
    return ex ? clone(ex) : null;
  }

  async getException(id) {
    const ex = this.exceptions.get(id);
    return ex ? clone(ex) : null;
  }

  async listExceptionEvents(exceptionId) {
    return this.exceptionEvents
      .filter((e) => e.exceptionId === exceptionId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async listExpiredOpenExceptions(nowIso, limit = 100) {
    return Array.from(this.exceptions.values())
      .filter((e) => e.status === "open" && Date.parse(e.deadlineAt) < Date.parse(nowIso))
      .sort((a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)))
      .slice(0, limit)
      .map(clone);
  }

  async resolveException(input) {
    const ex = this.exceptions.get(input.exceptionId);
    if (!ex) return { exception: null };
    if (ex.status !== "open") {
      const error = new Error("Exception is not open.");
      error.code = "ORDER_EXCEPTION_CLOSED";
      throw error;
    }
    const now = new Date().toISOString();
    ex.status = input.newStatus || "resolved";
    ex.resolution = input.resolution || "";
    ex.resolvedAt = now;
    ex.updatedAt = now;
    const item = this.items.get(ex.itemOrderId);
    const fromExc = item.exceptionStatus;
    item.exceptionStatus = input.itemExceptionStatus || "none";
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: ex.itemOrderId, field: "exception", from_status: fromExc,
      to_status: item.exceptionStatus, action: input.eventAction || "resolve", reason: "",
      actor_type: input.actorType || "system", actor_id: input.actorId || null, actor_role: "",
      idempotency_key: null, request_id: input.requestId || "", evidence: {}, created_at: now
    }));
    if (input.cancelItem && !["completed", "cancelled", "refunded", "destroyed"].includes(item.fulfillmentStatus)) {
      const fromFul = item.fulfillmentStatus;
      item.fulfillmentStatus = "cancelled";
      this.history.push(normalizeHistory({
        id: randomUUID(), item_order_id: ex.itemOrderId, field: "fulfillment", from_status: fromFul,
        to_status: "cancelled", action: input.eventAction || "cancel", reason: "",
        actor_type: input.actorType || "system", actor_id: input.actorId || null, actor_role: "",
        idempotency_key: null, request_id: input.requestId || "", evidence: {}, created_at: now
      }));
    }
    this.exceptionEvents.push(normalizeExceptionEvent({
      id: randomUUID(), exception_id: input.exceptionId, action: input.eventAction || "resolved",
      detail: input.eventDetail || {}, actor_type: input.actorType || "system", actor_id: input.actorId || null,
      created_at: now
    }));
    return { exception: clone(ex), item: clone(item) };
  }

  async claimItem({ itemId, adminUserId, requestId }) {
    const item = this.items.get(itemId);
    if (!item) return { item: null };
    if (item.fulfillmentStatus !== "agent_ordering" || item.claimedByAdminId) {
      const error = new Error("Item is not claimable.");
      error.code = "ORDER_STATUS_CONFLICT";
      throw error;
    }
    const now = new Date().toISOString();
    item.claimedByAdminId = adminUserId;
    item.claimedAt = now;
    item.fulfillmentStatus = "purchasing";
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: itemId, field: "fulfillment", from_status: "agent_ordering",
      to_status: "purchasing", action: "claim", reason: "", actor_type: "admin", actor_id: adminUserId,
      actor_role: "", idempotency_key: null, request_id: requestId || "", evidence: {}, created_at: now
    }));
    return { item: clone(item) };
  }

  async createPurchaseConfirmation(input) {
    const item = this.items.get(input.itemOrderId);
    if (!item) return { item: null };
    if (item.fulfillmentStatus !== "purchasing") {
      const error = new Error("Item is not in purchasing.");
      error.code = "ORDER_STATUS_CONFLICT";
      throw error;
    }
    if (this.confirmations.some((c) => c.itemOrderId === input.itemOrderId)) {
      const error = new Error("Already confirmed.");
      error.code = "23505";
      throw error;
    }
    const now = new Date().toISOString();
    const confirmation = normalizeConfirmation({
      id: randomUUID(), item_order_id: input.itemOrderId, buyer_admin_id: input.buyerAdminId || null,
      actual_platform: input.actualPlatform, actual_account: input.actualAccount || "",
      actual_order_no: input.actualOrderNo, spec: input.spec || "", quantity: input.quantity,
      cost_cents: input.costCents, shipping_cents: input.shippingCents || 0,
      voucher_keys: input.voucherKeys || [], created_at: now
    });
    this.confirmations.push(confirmation);
    item.fulfillmentStatus = "seller_dispatch_pending";
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: input.itemOrderId, field: "fulfillment", from_status: "purchasing",
      to_status: "seller_dispatch_pending", action: "confirm_purchase", reason: "", actor_type: "admin",
      actor_id: input.buyerAdminId || null, actor_role: "", idempotency_key: null,
      request_id: input.requestId || "", evidence: {}, created_at: now
    }));
    return { item: clone(item), confirmation: clone(confirmation) };
  }

  async findConfirmationByItem(itemId) {
    const c = this.confirmations.find((x) => x.itemOrderId === itemId);
    return c ? clone(c) : null;
  }

  async registerDispatch({ itemId, carrier, trackingNo, adminUserId, requestId, correct = false }) {
    const item = this.items.get(itemId);
    if (!item) return { item: null };
    const requiredFrom = correct ? "seller_dispatched" : "seller_dispatch_pending";
    if (item.fulfillmentStatus !== requiredFrom) {
      const error = new Error("Wrong state for dispatch.");
      error.code = "ORDER_STATUS_CONFLICT";
      throw error;
    }
    if (trackingNo) {
      const clash = Array.from(this.items.values())
        .find((io) => io.domesticTrackingNo === trackingNo && io.userId !== item.userId && io.id !== itemId);
      if (clash) {
        const error = new Error("Tracking bound to another user.");
        error.code = "ORDER_TRACKING_CONFLICT";
        throw error;
      }
    }
    const now = new Date().toISOString();
    if (correct) {
      if (carrier) item.carrier = carrier;
      if (trackingNo) item.domesticTrackingNo = trackingNo;
    } else {
      item.carrier = carrier || "";
      item.domesticTrackingNo = trackingNo || "";
      item.dispatchedAt = now;
      item.fulfillmentStatus = "seller_dispatched";
    }
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: itemId, field: "fulfillment", from_status: requiredFrom,
      to_status: "seller_dispatched", action: correct ? "correct_dispatch" : "register_dispatch", reason: "",
      actor_type: "admin", actor_id: adminUserId || null, actor_role: "", idempotency_key: null,
      request_id: requestId || "", evidence: {}, created_at: now
    }));
    return { item: clone(item) };
  }

  async reassignItem({ itemId, accountId, buyerAdminId, adminUserId, requestId }) {
    const item = this.items.get(itemId);
    if (!item) return { item: null };
    if (["completed", "cancelled", "refunded", "destroyed"].includes(item.fulfillmentStatus)) {
      const error = new Error("Terminal item.");
      error.code = "ORDER_STATUS_CONFLICT";
      throw error;
    }
    if (accountId) item.purchaseAccountId = accountId;
    if (buyerAdminId) item.claimedByAdminId = buyerAdminId;
    const now = new Date().toISOString();
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: itemId, field: "fulfillment", from_status: item.fulfillmentStatus,
      to_status: item.fulfillmentStatus, action: "reassign", reason: "", actor_type: "admin",
      actor_id: adminUserId || null, actor_role: "", idempotency_key: null, request_id: requestId || "",
      evidence: {}, created_at: now
    }));
    return { item: clone(item) };
  }

  async forceTransition({ itemId, to, action, adminUserId, requestId }) {
    const item = this.items.get(itemId);
    if (!item) return { item: null };
    const from = item.fulfillmentStatus;
    item.fulfillmentStatus = to;
    const now = new Date().toISOString();
    item.updatedAt = now;
    this.history.push(normalizeHistory({
      id: randomUUID(), item_order_id: itemId, field: "fulfillment", from_status: from, to_status: to,
      action: action || "controlled_correction", reason: "", actor_type: "admin", actor_id: adminUserId || null,
      actor_role: "", idempotency_key: null, request_id: requestId || "", evidence: {}, created_at: now
    }));
    return { item: clone(item) };
  }

  async listProcurementTasks({ scope, adminUserId, itemNo = null, platform = null, statuses = null, limit = 50, offset = 0 }) {
    const statusList = statuses && statuses.length ? statuses : ["agent_ordering", "purchasing", "seller_dispatch_pending"];
    let rows = Array.from(this.items.values()).filter((io) => statusList.includes(io.fulfillmentStatus));
    if (platform) rows = rows.filter((io) => io.platform === platform);
    if (itemNo) rows = rows.filter((io) => String(io.itemNo || "").toUpperCase() === itemNo.toUpperCase());
    if (scope === "SELF") rows = rows.filter((io) => io.claimedByAdminId === adminUserId);
    rows = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return rows.slice(offset, offset + limit).map(clone);
  }

  async findItemById(itemId) {
    const item = this.items.get(itemId);
    return item ? clone(item) : null;
  }

  async findItemByTrackingNo(trackingNo) {
    const matches = Array.from(this.items.values())
      .filter((it) => it.domesticTrackingNo === trackingNo)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return matches[0] ? clone(matches[0]) : null;
  }

  async listItemHistory(itemId) {
    return this.history
      .filter((row) => row.itemOrderId === itemId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async findTransition(itemId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const row = this.history.find((entry) => entry.itemOrderId === itemId && entry.idempotencyKey === idempotencyKey);
    return row ? clone(row) : null;
  }

  async transitionItemStatus({
    itemId, field, expectedFrom, to, action, reason, actorType, actorId, actorRole,
    idempotencyKey, requestId, evidence
  }) {
    const col = statusColumn(field) === "exception_status" ? "exceptionStatus" : "fulfillmentStatus";
    const item = this.items.get(itemId);
    if (!item) {
      return { item: null };
    }
    if (idempotencyKey && this.history.some((row) => row.itemOrderId === itemId && row.idempotencyKey === idempotencyKey)) {
      return { item: clone(item), replay: true };
    }
    if (item[col] !== expectedFrom) {
      const error = new Error("Item status changed concurrently.");
      error.code = "ORDER_STATUS_CONFLICT";
      throw error;
    }
    item[col] = to;
    item.updatedAt = new Date().toISOString();
    const history = normalizeHistory({
      id: randomUUID(),
      item_order_id: itemId,
      field,
      from_status: expectedFrom,
      to_status: to,
      action,
      reason: reason || "",
      actor_type: actorType,
      actor_id: actorId || null,
      actor_role: actorRole || "",
      idempotency_key: idempotencyKey || null,
      request_id: requestId || "",
      evidence: evidence || {},
      created_at: new Date().toISOString()
    });
    this.history.push(history);
    return { item: clone(item), history: clone(history), replay: false };
  }

  async findParentBySubmitKey(userId, submitKey) {
    const id = this.parentsBySubmit.get(`${userId}:${submitKey}`);
    return id ? clone(this.parents.get(id)) : null;
  }

  async findParentById(userId, parentId) {
    const parent = this.parents.get(parentId);
    return parent?.userId === userId ? clone(parent) : null;
  }

  async findParentByIdAny(parentId) {
    const parent = this.parents.get(parentId);
    return parent ? clone(parent) : null;
  }

  async markParentPaid(parentId) {
    const parent = this.parents.get(parentId);
    if (!parent || parent.paymentStatus !== "unpaid") {
      return null;
    }
    parent.paymentStatus = "paid";
    parent.paidAt = new Date().toISOString();
    parent.updatedAt = parent.paidAt;
    return clone(parent);
  }

  async assignItemAccount(itemId, accountId) {
    const item = this.items.get(itemId);
    if (!item || item.purchaseAccountId) {
      return null;
    }
    item.purchaseAccountId = accountId;
    item.assignedAt = new Date().toISOString();
    item.updatedAt = item.assignedAt;
    return clone(item);
  }

  async listItemsByParent(parentId) {
    return Array.from(this.items.values())
      .filter((item) => item.parentOrderId === parentId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async listParents(userId) {
    return Array.from(this.parents.values())
      .filter((parent) => parent.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(clone);
  }

  async createOrderWithItems({ parent, items }) {
    const key = `${parent.userId}:${parent.submitKey}`;
    if (this.parentsBySubmit.has(key)) {
      const error = new Error("duplicate submit key");
      error.code = "23505";
      throw error;
    }
    const now = new Date().toISOString();
    const parentRow = normalizeParent({
      id: randomUUID(),
      order_no: parent.orderNo,
      user_id: parent.userId,
      submit_key: parent.submitKey,
      item_count: parent.itemCount,
      items_total_cents: parent.itemsTotalCents,
      currency: parent.currency,
      payment_status: "unpaid",
      paid_at: null,
      created_at: now,
      updated_at: now
    });
    const itemRows = items.map((item, offset) => normalizeItem({
      id: randomUUID(),
      item_no: item.itemNo,
      parent_order_id: parentRow.id,
      user_id: parent.userId,
      snapshot_id: item.snapshotId,
      platform: item.platform || "",
      purchase_account_id: null,
      assigned_at: null,
      spec: item.spec || "",
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      items_cents: item.itemsCents,
      domestic_shipping_cents: item.domesticShippingCents,
      total_cents: item.totalCents,
      currency: item.currency,
      fulfillment_status: "pending_payment",
      exception_status: "none",
      created_at: new Date(Date.parse(now) + offset).toISOString(),
      updated_at: now
    }));
    // Commit only after every row is built (all-or-nothing).
    this.parents.set(parentRow.id, parentRow);
    this.parentsBySubmit.set(key, parentRow.id);
    for (const row of itemRows) {
      this.items.set(row.id, row);
    }
    return { parent: clone(parentRow), items: itemRows.map(clone) };
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
