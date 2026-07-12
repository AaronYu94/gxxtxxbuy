import { randomUUID } from "node:crypto";
import { normalizeInbound } from "../../src/wms/wms-repository.js";

export class MemoryWmsRepository {
  constructor() {
    this.inbound = new Map();
    this.byTracking = new Map();
    this.qcTasks = new Map();
    this.qcPhotos = [];
    this.qcPurchases = new Map();
    this.qcExceptions = [];
    this.inventory = new Map();
    this.locations = new Map();
    this.movements = [];
    this.storageExtensions = [];
    this.reminders = new Set();
    this.destroyRecords = new Map();
  }

  async findStorageExtensionByIdem(userId, key) {
    if (!key) return null;
    return this.storageExtensions.find((e) => e.userId === userId && e.idempotencyKey === key) || null;
  }

  async addStorageExtension({ inventoryUnitId, userId, months, amountMinor, ledgerTxId, idempotencyKey }) {
    const inv = this.inventory.get(inventoryUnitId);
    if (!inv) return { inventory: null };
    if ((inv.paidExtensionMonths || 0) + months > 2) { const e = new Error("max"); e.code = "STORAGE_MAX_EXTENSION"; throw e; }
    inv.paidExtensionMonths = (inv.paidExtensionMonths || 0) + months;
    inv.updatedAt = new Date().toISOString();
    this.storageExtensions.push({ id: randomUUID(), inventoryUnitId, userId, months, amountMinor, ledgerTxId, idempotencyKey, createdAt: inv.updatedAt });
    return { inventory: clone(inv) };
  }

  async listActiveInventory(limit = 500) {
    return Array.from(this.inventory.values()).filter((i) => ["in_stock", "reserved", "return_reserved"].includes(i.status)).slice(0, limit).map(clone);
  }

  async markReminderSent(unitId, milestone) {
    const k = `${unitId}:${milestone}`;
    if (this.reminders.has(k)) return false;
    this.reminders.add(k);
    return true;
  }

  async markForDestroy(unitId) {
    const inv = this.inventory.get(unitId);
    if (!inv || inv.status !== "in_stock") return null;
    inv.status = "destroy_pending"; inv.updatedAt = new Date().toISOString();
    return clone(inv);
  }

  async executeDestroy({ inventoryUnitId, quantity, photoKeys, adminUserId }) {
    const inv = this.inventory.get(inventoryUnitId);
    if (!inv) return { inventory: null };
    if (inv.status === "destroyed") return { inventory: clone(inv), replay: true };
    if (inv.status !== "destroy_pending") { const e = new Error("state"); e.code = "DESTROY_STATE"; throw e; }
    inv.status = "destroyed"; inv.updatedAt = new Date().toISOString();
    this.destroyRecords.set(inventoryUnitId, { quantity, photoKeys, adminUserId });
    return { inventory: clone(inv), replay: false };
  }

  async createLocation(input) {
    const now = new Date().toISOString();
    for (const l of this.locations.values()) if (l.code === input.code) { const e = new Error("dup"); e.code = "23505"; throw e; }
    const l = { id: randomUUID(), code: input.code, area: input.area || "", shelf: input.shelf || "", level: input.level || "", position: input.position || "", enabled: true, createdAt: now };
    this.locations.set(l.id, l);
    return clone(l);
  }

  async findLocationByCode(code) { for (const l of this.locations.values()) if (l.code === code) return clone(l); return null; }
  async findLocationById(id) { const l = this.locations.get(id); return l ? clone(l) : null; }
  async listLocations(limit = 200) { return Array.from(this.locations.values()).slice(0, limit).map(clone); }

  async locationOccupancy(locationId) {
    return Array.from(this.inventory.values()).filter((i) => i.locationId === locationId && !["outbound", "returned", "destroyed"].includes(i.status)).length;
  }

  async disableLocation(id) { const l = this.locations.get(id); if (!l) return null; l.enabled = false; return clone(l); }
  async findInventoryByStockNo(stockNo) { for (const i of this.inventory.values()) if (i.stockNo === stockNo) return clone(i); return null; }

  async assignLocation({ stockNo, locationId, adminUserId }) {
    let inv = null; for (const i of this.inventory.values()) if (i.stockNo === stockNo) inv = i;
    if (!inv) return { inventory: null };
    if (inv.locationId === locationId) return { inventory: clone(inv), replay: true };
    if (inv.locationId) { const e = new Error("occupied"); e.code = "LOCATION_OCCUPIED"; throw e; }
    inv.locationId = locationId; inv.updatedAt = new Date().toISOString();
    this.movements.push({ id: randomUUID(), inventoryUnitId: inv.id, fromLocationId: null, toLocationId: locationId, reason: "assign", movedByAdminId: adminUserId || null, createdAt: inv.updatedAt });
    return { inventory: clone(inv), replay: false };
  }

  async moveLocation({ stockNo, fromLocationId, toLocationId, reason, adminUserId }) {
    let inv = null; for (const i of this.inventory.values()) if (i.stockNo === stockNo) inv = i;
    if (!inv) return { inventory: null };
    if (inv.locationId !== fromLocationId) { const e = new Error("mismatch"); e.code = "LOCATION_MISMATCH"; throw e; }
    inv.locationId = toLocationId; inv.updatedAt = new Date().toISOString();
    this.movements.push({ id: randomUUID(), inventoryUnitId: inv.id, fromLocationId, toLocationId, reason: reason || "", movedByAdminId: adminUserId || null, createdAt: inv.updatedAt });
    return { inventory: clone(inv) };
  }

  async listMovements(inventoryUnitId) { return this.movements.filter((m) => m.inventoryUnitId === inventoryUnitId).map(clone); }

  async setShippingRestrictions({ inventoryUnitId, restrictions }) {
    const inv = this.inventory.get(inventoryUnitId);
    if (!inv) return null;
    inv.shippingRestrictions = restrictions; inv.updatedAt = new Date().toISOString();
    return clone(inv);
  }

  async findInventoryByItem(itemOrderId) {
    for (const i of this.inventory.values()) if (i.itemOrderId === itemOrderId) return clone(i);
    return null;
  }

  async findInventoryById(id) {
    const i = this.inventory.get(id);
    return i ? clone(i) : null;
  }

  async listInventoryByUser(userId, limit = 50) {
    return Array.from(this.inventory.values()).filter((i) => i.userId === userId).slice(0, limit).map(clone);
  }

  async completeQcAndStock({ qcTaskId, itemOrderId, userId, stockNo }) {
    const task = this.qcTasks.get(qcTaskId);
    if (!task) return { task: null };
    if (task.status === "completed") {
      let inv = null;
      for (const i of this.inventory.values()) if (i.itemOrderId === itemOrderId) inv = i;
      return { task: clone(task), inventory: inv ? clone(inv) : null, replay: true };
    }
    if (task.status !== "in_progress") { const e = new Error("state"); e.code = "QC_STATE"; throw e; }
    const now = new Date().toISOString();
    task.status = "completed"; task.completedAt = now; task.updatedAt = now;
    const inv = {
      id: randomUUID(), stockNo, itemOrderId, qcTaskId, userId, status: "in_stock",
      officialInboundAt: now, returnDeadlineAt: new Date(Date.parse(now) + 5 * 86400000).toISOString(),
      locationId: null, paidExtensionMonths: 0, shippingRestrictions: [], createdAt: now, updatedAt: now
    };
    this.inventory.set(inv.id, inv);
    return { task: clone(task), inventory: clone(inv), replay: false };
  }

  async findQcPurchaseByIdem(userId, key) {
    if (!key) return null;
    for (const p of this.qcPurchases.values()) if (p.userId === userId && p.idempotencyKey === key) return clone(p);
    return null;
  }

  async createQcPurchase(input) {
    const now = new Date().toISOString();
    const p = {
      id: randomUUID(), itemOrderId: input.itemOrderId, qcTaskId: input.qcTaskId || null, userId: input.userId,
      kind: input.kind, quantity: input.quantity, amountCnyMinor: input.amountCnyMinor, status: "paid",
      ledgerTxId: input.ledgerTxId || null, idempotencyKey: input.idempotencyKey || null, detail: input.detail || {}, createdAt: now
    };
    this.qcPurchases.set(p.id, p);
    return clone(p);
  }

  async listQcPurchases(itemOrderId) {
    return Array.from(this.qcPurchases.values()).filter((p) => p.itemOrderId === itemOrderId).map(clone);
  }

  async createQcException(input) {
    const now = new Date().toISOString();
    const e = {
      id: randomUUID(), qcTaskId: input.qcTaskId, type: input.type, note: input.note || "",
      photoKeys: input.photoKeys || [], status: "open", createdByAdminId: input.createdByAdminId || null,
      resolvedByAdminId: null, createdAt: now, resolvedAt: null
    };
    this.qcExceptions.push(e);
    return clone(e);
  }

  async listQcExceptions(qcTaskId) {
    return this.qcExceptions.filter((e) => e.qcTaskId === qcTaskId).map(clone);
  }

  async hasOpenException(qcTaskId) {
    return this.qcExceptions.some((e) => e.qcTaskId === qcTaskId && e.status === "open");
  }

  async resolveQcExceptions(qcTaskId, adminUserId) {
    const now = new Date().toISOString();
    this.qcExceptions.forEach((e) => {
      if (e.qcTaskId === qcTaskId && e.status === "open") { e.status = "resolved"; e.resolvedByAdminId = adminUserId || null; e.resolvedAt = now; }
    });
  }

  async createQcTask(input) {
    if (input.type === "standard") {
      for (const t of this.qcTasks.values()) {
        if (t.itemOrderId === input.itemOrderId && t.type === "standard") { const e = new Error("dup"); e.code = "23505"; throw e; }
      }
    }
    const now = new Date().toISOString();
    const t = {
      id: randomUUID(), itemOrderId: input.itemOrderId, inboundPackageId: input.inboundPackageId || null,
      userId: input.userId, type: input.type || "standard", status: "pending", assigneeAdminId: null,
      claimedAt: null, unpackRequired: Boolean(input.unpackRequired), waitHours: input.waitHours || 0,
      exceptionNote: "", completedAt: null, createdAt: now, updatedAt: now
    };
    this.qcTasks.set(t.id, t);
    return clone(t);
  }

  async findQcTask(id) { const t = this.qcTasks.get(id); return t ? clone(t) : null; }

  async findStandardQcTaskByItem(itemOrderId) {
    for (const t of this.qcTasks.values()) if (t.itemOrderId === itemOrderId && t.type === "standard") return clone(t);
    return null;
  }

  async listQcTasks({ status = null, assigneeAdminId = null, limit = 50 } = {}) {
    return Array.from(this.qcTasks.values())
      .filter((t) => (status === null || t.status === status) && (assigneeAdminId === null || t.assigneeAdminId === assigneeAdminId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit).map(clone);
  }

  async claimQcTask(id, adminUserId) {
    const t = this.qcTasks.get(id);
    if (!t || t.status !== "pending") return null;
    t.status = "claimed"; t.assigneeAdminId = adminUserId; t.claimedAt = new Date().toISOString(); t.updatedAt = t.claimedAt;
    return clone(t);
  }

  async startQcTask(id, adminUserId) {
    const t = this.qcTasks.get(id);
    if (!t || t.status !== "claimed" || t.assigneeAdminId !== adminUserId) return null;
    t.status = "in_progress"; t.updatedAt = new Date().toISOString();
    return clone(t);
  }

  async releaseQcTask(id) {
    const t = this.qcTasks.get(id);
    if (!t || !["claimed", "in_progress"].includes(t.status)) return null;
    t.status = "pending"; t.assigneeAdminId = null; t.claimedAt = null; t.updatedAt = new Date().toISOString();
    return clone(t);
  }

  async markQcTask(id, patch) {
    const t = this.qcTasks.get(id);
    if (!t) return null;
    if (patch.status) t.status = patch.status;
    if (patch.exceptionNote !== null && patch.exceptionNote !== undefined) t.exceptionNote = patch.exceptionNote;
    if (patch.completedAt !== null && patch.completedAt !== undefined) t.completedAt = patch.completedAt;
    t.updatedAt = new Date().toISOString();
    return clone(t);
  }

  async addQcPhoto({ qcTaskId, slot, storageKey }) {
    const version = this.qcPhotos.filter((p) => p.qcTaskId === qcTaskId && p.slot === slot).reduce((m, p) => Math.max(m, p.version), 0) + 1;
    const photo = { id: randomUUID(), qcTaskId, slot, storageKey, version, createdAt: new Date().toISOString() };
    this.qcPhotos.push(photo);
    return clone(photo);
  }

  async currentQcSlots(qcTaskId) {
    return [...new Set(this.qcPhotos.filter((p) => p.qcTaskId === qcTaskId).map((p) => p.slot))];
  }

  async listQcPhotos(qcTaskId) {
    return this.qcPhotos.filter((p) => p.qcTaskId === qcTaskId).map(clone);
  }

  async findInboundByTracking(trackingNo) {
    const id = this.byTracking.get(trackingNo);
    return id ? clone(this.inbound.get(id)) : null;
  }

  async findInboundById(id) {
    const p = this.inbound.get(id);
    return p ? clone(p) : null;
  }

  async createInbound(input) {
    if (this.byTracking.has(input.domesticTrackingNo)) {
      const error = new Error("duplicate tracking");
      error.code = "23505";
      throw error;
    }
    const now = new Date().toISOString();
    const p = normalizeInbound({
      id: randomUUID(), domestic_tracking_no: input.domesticTrackingNo, carrier: input.carrier || "",
      item_order_id: input.itemOrderId || null, user_id: input.userId || null, status: input.status || "unclaimed",
      first_scanned_by_admin_id: input.firstScannedByAdminId || null, first_scanned_at: now,
      weight_grams: null, length_mm: null, width_mm: null, height_mm: null, photo_keys: [],
      measured_at: null, measurement_version: 0, linked_by_admin_id: null, link_evidence: [],
      created_at: now, updated_at: now
    });
    this.inbound.set(p.id, p);
    this.byTracking.set(p.domesticTrackingNo, p.id);
    return clone(p);
  }

  async linkInbound(id, input) {
    const p = this.inbound.get(id);
    if (!p || p.status !== "unclaimed") return null;
    p.itemOrderId = input.itemOrderId;
    p.userId = input.userId;
    p.status = "matched";
    p.linkedByAdminId = input.linkedByAdminId || null;
    p.linkEvidence = input.linkEvidence || [];
    p.updatedAt = new Date().toISOString();
    return clone(p);
  }

  async submitMeasurement(id, input) {
    const p = this.inbound.get(id);
    if (!p || p.measurementVersion !== input.expectedVersion) return null;
    p.weightGrams = input.weightGrams;
    p.lengthMm = input.lengthMm;
    p.widthMm = input.widthMm;
    p.heightMm = input.heightMm;
    p.photoKeys = input.photoKeys || [];
    p.measuredAt = new Date().toISOString();
    p.measurementVersion += 1;
    p.status = "measured";
    p.updatedAt = p.measuredAt;
    return clone(p);
  }

  async listUnclaimed(limit = 50) {
    return Array.from(this.inbound.values())
      .filter((p) => p.status === "unclaimed")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit).map(clone);
  }

  async listInboundByUser(userId, limit = 50) {
    return Array.from(this.inbound.values())
      .filter((p) => p.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit).map(clone);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
