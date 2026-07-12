import { randomUUID } from "node:crypto";
import { AFTER_SALES_ROLE } from "../../src/after_sales/after-sales-status.js";

// In-memory double for the after-sales repository (V2-08).
export class MemoryAfterSalesRepository {
  constructor() {
    this.orders = new Map();       // id -> order
    this.history = [];             // rows
    this.attachments = [];         // rows
    this.bills = new Map();        // id -> bill
    this.inspections = new Map();  // after_sales_id -> inspection
    this.shipments = new Map();    // after_sales_id -> shipment
    this.inventory = new Map();    // item_order_id -> unit
  }

  // Test seam: register an officially-warehoused unit for an item.
  seedInventory(unit) {
    const u = {
      id: unit.id || randomUUID(), stockNo: unit.stockNo || `GO-STOCK-${Math.floor(Math.random() * 1e6)}`,
      itemOrderId: unit.itemOrderId, userId: unit.userId, status: unit.status || "in_stock",
      officialInboundAt: unit.officialInboundAt || new Date().toISOString(),
      returnDeadlineAt: unit.returnDeadlineAt || new Date(Date.now() + 5 * 86400000).toISOString()
    };
    this.inventory.set(u.itemOrderId, u);
    return u;
  }

  async findInventoryByItem(itemOrderId) { return this.inventory.get(itemOrderId) || null; }

  _active(itemOrderId) {
    return [...this.orders.values()].filter((o) => o.itemOrderId === itemOrderId && !["completed", "rejected", "closed"].includes(o.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }

  async createReturn({ asNo, itemOrderId, inventoryUnitId, userId, reason, description, quantity, evidencePhotoKeys, deadlineAt, actor }) {
    const unit = [...this.inventory.values()].find((u) => u.id === inventoryUnitId);
    if (!unit) { const e = new Error("no_unit"); e.code = "UNIT_NOT_FOUND"; throw e; }
    if (unit.userId !== userId) { const e = new Error("not_owner"); e.code = "UNIT_NOT_OWNED"; throw e; }
    if (unit.status !== "in_stock") { const e = new Error("na"); e.code = "UNIT_NOT_AVAILABLE"; e.status = unit.status; throw e; }
    if (this._active(itemOrderId)) { const e = new Error("dup"); e.code = "AFTER_SALES_EXISTS"; throw e; }
    const order = {
      id: randomUUID(), asNo, itemOrderId, inventoryUnitId, userId, status: "purchase_review_pending",
      reason: reason || "", description: description || "", quantity: quantity || 1, responsibleParty: null, freightParty: null,
      rejectReason: "", merchantRefundCnyMinor: 0, merchantDeductionCnyMinor: 0, platformRefundCnyMinor: 0,
      returnFeeBillId: null, refundLedgerTxId: null, currentOwnerRole: "procurement", deadlineAt: deadlineAt || null,
      closedAt: null, completedAt: null, version: 1, createdAt: new Date().toISOString()
    };
    this.orders.set(order.id, order);
    unit.status = "return_reserved";
    if (Array.isArray(evidencePhotoKeys) && evidencePhotoKeys.length > 0) {
      this.attachments.push({ id: randomUUID(), afterSalesId: order.id, kind: "evidence", photoKeys: evidencePhotoKeys, note: "", createdByType: "user", createdById: userId, createdAt: new Date().toISOString() });
    }
    this.history.push({ id: randomUUID(), afterSalesId: order.id, fromStatus: "", toStatus: "purchase_review_pending", action: "open_return", actorType: actor?.type || "user", actorId: actor?.id || userId, actorRole: "user", reason: reason || "", note: "", metadata: {}, createdAt: new Date().toISOString() });
    return { ...order };
  }

  async findById(id) { const o = this.orders.get(id); return o ? { ...o } : null; }
  async findActiveByItem(itemOrderId) { const o = this._active(itemOrderId); return o ? { ...o } : null; }
  async listByUser(userId) { return [...this.orders.values()].filter((o) => o.userId === userId).map((o) => ({ ...o })); }
  async listByStatus({ status = null, role = null, limit = 50 } = {}) {
    return [...this.orders.values()].filter((o) => (!status || o.status === status) && (!role || o.currentOwnerRole === role)).slice(0, limit).map((o) => ({ ...o }));
  }

  async transition({ afterSalesId, toStatus, action, actor, reason = "", note = "", patch = {}, expectedVersion, metadata = {} }) {
    const order = this.orders.get(afterSalesId);
    if (!order) return { notFound: true };
    if (expectedVersion != null && order.version !== expectedVersion) return { versionConflict: true, current: { ...order } };
    const from = order.status;
    order.status = toStatus;
    order.currentOwnerRole = AFTER_SALES_ROLE[toStatus] || order.currentOwnerRole;
    order.version += 1;
    for (const [k, v] of Object.entries(patch)) {
      const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      order[camel] = v;
    }
    this.history.push({ id: randomUUID(), afterSalesId, fromStatus: from, toStatus, action, actorType: actor?.type || "system", actorId: actor?.id || null, actorRole: actor?.role || "", reason, note, metadata, createdAt: new Date().toISOString() });
    return { order: { ...order }, from };
  }

  async addAttachment({ afterSalesId, kind, photoKeys, note, createdByType, createdById }) {
    const a = { id: randomUUID(), afterSalesId, kind, photoKeys: photoKeys || [], note: note || "", createdByType: createdByType || "user", createdById: createdById || null, createdAt: new Date().toISOString() };
    this.attachments.push(a);
    return { ...a };
  }
  async listAttachments(afterSalesId, { kind = null } = {}) { return this.attachments.filter((a) => a.afterSalesId === afterSalesId && (!kind || a.kind === kind)).map((a) => ({ ...a })); }
  async listHistory(afterSalesId) { return this.history.filter((h) => h.afterSalesId === afterSalesId).map((h) => ({ ...h })); }

  async releaseUnit(inventoryUnitId) { const u = [...this.inventory.values()].find((x) => x.id === inventoryUnitId); if (u && u.status === "return_reserved") u.status = "in_stock"; }
  async markUnitReturning(inventoryUnitId) { const u = [...this.inventory.values()].find((x) => x.id === inventoryUnitId); if (u) u.status = "returning"; }
  async markUnitReturned(inventoryUnitId) { const u = [...this.inventory.values()].find((x) => x.id === inventoryUnitId); if (u) u.status = "returned"; }

  async createReturnFeeBill({ billNo, afterSalesId, userId, subtotalMinor, totalMinor, breakdown }) {
    for (const b of this.bills.values()) { if (b.afterSalesId === afterSalesId && b.kind === "return_fee" && b.status !== "cancelled") { const e = new Error("dup"); e.code = "BILL_EXISTS"; throw e; } }
    const bill = { id: randomUUID(), billNo, afterSalesId, userId, kind: "return_fee", status: "payable", subtotalCnyMinor: subtotalMinor, totalCnyMinor: totalMinor, breakdown: breakdown || {}, ledgerTxId: null, paidAt: null, createdAt: new Date().toISOString() };
    this.bills.set(bill.id, bill);
    return { ...bill };
  }
  async findActiveBill(afterSalesId, kind = "return_fee") {
    return [...this.bills.values()].filter((b) => b.afterSalesId === afterSalesId && b.kind === kind && b.status !== "cancelled").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }
  async listBills(afterSalesId) { return [...this.bills.values()].filter((b) => b.afterSalesId === afterSalesId).map((b) => ({ ...b })); }
  async markBillPaid({ billId, ledgerTxId, idempotencyKey }) {
    const b = this.bills.get(billId);
    if (!b || b.status !== "payable") return null;
    b.status = "paid"; b.ledgerTxId = ledgerTxId; b.paidAt = new Date().toISOString();
    return { ...b };
  }

  async recordInspection({ afterSalesId, quantityMatched, specMatched, photoKeys, weightGrams, lengthMm, widthMm, heightMm, note, adminId }) {
    const i = { id: randomUUID(), afterSalesId, quantityMatched, specMatched, photoKeys: photoKeys || [], weightGrams: weightGrams || null, lengthMm: lengthMm || null, widthMm: widthMm || null, heightMm: heightMm || null, note: note || "", createdAt: new Date().toISOString() };
    this.inspections.set(afterSalesId, i);
    return { ...i };
  }
  async findInspection(afterSalesId) { const i = this.inspections.get(afterSalesId); return i ? { ...i } : null; }

  async createShipment({ afterSalesId, carrier, trackingNo, merchantAddressSnapshot, adminId }) {
    if (this.shipments.has(afterSalesId)) { const e = new Error("dup"); e.code = "SHIPMENT_EXISTS"; throw e; }
    for (const s of this.shipments.values()) { if (trackingNo && s.trackingNo === trackingNo) { const e = new Error("dup"); e.code = "TRACKING_DUPLICATE"; throw e; } }
    const s = { id: randomUUID(), afterSalesId, carrier: carrier || "", trackingNo: trackingNo || "", merchantAddressSnapshot: merchantAddressSnapshot || {}, status: "shipped", events: [], createdAt: new Date().toISOString() };
    this.shipments.set(afterSalesId, s);
    return { ...s };
  }
  async findShipment(afterSalesId) { const s = this.shipments.get(afterSalesId); return s ? { ...s } : null; }
  async appendShipmentEvent({ afterSalesId, event, status = null }) {
    const s = this.shipments.get(afterSalesId);
    if (!s) return null;
    s.events = [...s.events, event];
    if (status) s.status = status;
    return { ...s };
  }

  async scanReturnPick({ afterSalesId, stockNo, expectedStatus, toStatus, adminId }) {
    const order = this.orders.get(afterSalesId);
    if (!order) return { notFound: true };
    if (order.status !== expectedStatus) return { conflict: true, status: order.status };
    const unit = [...this.inventory.values()].find((u) => u.id === order.inventoryUnitId);
    if (!unit || unit.stockNo !== stockNo) return { wrongItem: true };
    unit.status = "returning";
    order.status = toStatus; order.currentOwnerRole = "warehouse"; order.version += 1;
    this.history.push({ id: randomUUID(), afterSalesId, fromStatus: expectedStatus, toStatus, action: "return_pick_scan", actorType: "admin", actorId: adminId, actorRole: "warehouse", reason: "", note: "", metadata: { stock_no: stockNo }, createdAt: new Date().toISOString() });
    return { order: { ...order }, stockNo };
  }
}
