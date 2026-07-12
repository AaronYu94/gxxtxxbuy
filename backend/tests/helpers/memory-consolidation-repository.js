import { randomUUID } from "node:crypto";

// In-memory double for the consolidation repository (V2-07-04/05/06/07).
export class MemoryConsolidationRepository {
  constructor() {
    this.vas = new Map();          // id -> vas
    this.parcels = new Map();      // id -> parcel
    this.items = [];               // parcel_items
    this.parcelVas = [];           // parcel_value_added_services
    this.bills = new Map();        // id -> bill
    this.pickingTasks = new Map(); // parcel_id -> task
    this.outboundRecords = new Map(); // parcel_id -> record
    this.inventory = new Map();    // stock_no -> unit (seeded by tests)
  }

  // Test seam: register an inventory unit as officially warehoused.
  seedInventory(unit) {
    const u = { id: unit.id || randomUUID(), stockNo: unit.stockNo, itemOrderId: unit.itemOrderId || randomUUID(), userId: unit.userId, status: unit.status || "in_stock", officialInboundAt: unit.officialInboundAt || new Date().toISOString(), returnDeadlineAt: unit.returnDeadlineAt || null, locationId: unit.locationId || null, paidExtensionMonths: 0, createdAt: new Date().toISOString() };
    this.inventory.set(u.stockNo, u);
    return u;
  }

  async createValueAddedService(input) {
    const vas = { id: randomUUID(), code: input.code, name: input.name || "", description: input.description || "", priceCnyMinor: input.priceCnyMinor ?? 0, requiresPhoto: Boolean(input.requiresPhoto), enabled: input.enabled !== false, createdAt: new Date().toISOString() };
    this.vas.set(vas.id, vas);
    return vas;
  }
  async updateValueAddedService(id, patch) {
    const vas = this.vas.get(id);
    if (!vas) return null;
    if (patch.name != null) vas.name = patch.name;
    if (patch.description != null) vas.description = patch.description;
    if (patch.priceCnyMinor != null) vas.priceCnyMinor = patch.priceCnyMinor;
    if (patch.requiresPhoto != null) vas.requiresPhoto = patch.requiresPhoto;
    if (patch.enabled != null) vas.enabled = patch.enabled;
    return vas;
  }
  async listValueAddedServices({ enabledOnly = false } = {}) {
    return [...this.vas.values()].filter((v) => !enabledOnly || v.enabled).sort((a, b) => a.code.localeCompare(b.code));
  }
  async findVasById(id) { return this.vas.get(id) || null; }
  async findVasByCodes(codes) { return [...this.vas.values()].filter((v) => codes.includes(v.code)); }

  async listEligibleStock(userId) {
    const reserved = new Set(this.items.filter((it) => !it.releasedAt).map((it) => it.inventoryUnitId));
    return [...this.inventory.values()]
      .filter((u) => u.userId === userId && u.status === "in_stock" && !reserved.has(u.id))
      .sort((a, b) => String(a.officialInboundAt).localeCompare(String(b.officialInboundAt)));
  }

  async findParcelById(id) { return this.parcels.get(id) || null; }
  async listParcelsByUser(userId) {
    return [...this.parcels.values()].filter((p) => p.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async listParcelItems(parcelId, { liveOnly = true } = {}) {
    return this.items.filter((it) => it.parcelId === parcelId && (!liveOnly || !it.releasedAt))
      .map((it) => ({ ...it, stockNo: [...this.inventory.values()].find((u) => u.id === it.inventoryUnitId)?.stockNo || null }));
  }
  async listParcelVas(parcelId) { return this.parcelVas.filter((v) => v.parcelId === parcelId); }

  async createParcelWithReservation({ userId, addressId, recipientSnapshot, destinationCountry, parcelNo, stockNos, valueAddedServices = [] }) {
    const units = [];
    for (const stockNo of stockNos) {
      const unit = this.inventory.get(stockNo);
      if (!unit) { const e = new Error("unit_not_found"); e.code = "UNIT_NOT_FOUND"; e.stockNo = stockNo; throw e; }
      if (unit.userId !== userId) { const e = new Error("not_owner"); e.code = "UNIT_NOT_OWNED"; e.stockNo = stockNo; throw e; }
      if (unit.status !== "in_stock") { const e = new Error("not_in_stock"); e.code = "UNIT_NOT_ELIGIBLE"; e.stockNo = stockNo; throw e; }
      const live = this.items.some((it) => it.inventoryUnitId === unit.id && !it.releasedAt);
      if (live) { const e = new Error("already_reserved"); e.code = "UNIT_ALREADY_RESERVED"; e.stockNo = stockNo; throw e; }
      units.push(unit);
    }
    const parcel = { id: randomUUID(), parcelNo, userId, addressId: addressId || null, recipientSnapshot: recipientSnapshot || {}, destinationCountry: destinationCountry || "", routeId: null, status: "draft", packingFeeBillId: null, shippingFeeBillId: null, declaredWeightGrams: null, finalWeightGrams: null, chargeableWeightGrams: null, dimensions: {}, trackingNo: "", outboundBatchId: null, version: 1, packingStartedAt: null, cancelledAt: null, createdAt: new Date().toISOString() };
    this.parcels.set(parcel.id, parcel);
    for (const unit of units) {
      this.items.push({ id: randomUUID(), parcelId: parcel.id, inventoryUnitId: unit.id, itemOrderId: unit.itemOrderId, releasedAt: null, createdAt: new Date().toISOString() });
      unit.status = "reserved";
    }
    for (const v of valueAddedServices) {
      this.parcelVas.push({ id: randomUUID(), parcelId: parcel.id, valueAddedServiceId: v.id, code: v.code, name: v.name, priceCnyMinor: v.priceCnyMinor, requiresPhoto: v.requiresPhoto, status: "pending", photoKeys: [], executedAt: null, createdAt: new Date().toISOString() });
    }
    return { parcel, itemOrderIds: units.map((u) => u.itemOrderId) };
  }

  async submitParcelWithBill({ parcelId, expectedStatus, billNo, subtotalMinor, membershipDiscountMinor, couponDiscountMinor, couponCode, totalMinor, breakdown }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (parcel.status !== expectedStatus) return { conflict: true, status: parcel.status };
    const bill = { id: randomUUID(), billNo, parcelId, userId: parcel.userId, kind: "packing", status: "payable", subtotalCnyMinor: subtotalMinor, membershipDiscountCnyMinor: membershipDiscountMinor, couponDiscountCnyMinor: couponDiscountMinor, couponCode: couponCode || "", totalCnyMinor: totalMinor, breakdown: breakdown || {}, ledgerTxId: null, refundLedgerTxId: null, paidAt: null, createdAt: new Date().toISOString() };
    this.bills.set(bill.id, bill);
    parcel.status = "packing_fee_due";
    parcel.packingFeeBillId = bill.id;
    return { parcel, bill };
  }
  async findBillById(id) { return this.bills.get(id) || null; }
  async findActiveBill(parcelId, kind) {
    return [...this.bills.values()].filter((b) => b.parcelId === parcelId && b.kind === kind && b.status !== "cancelled").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }
  async listBillsByParcel(parcelId) { return [...this.bills.values()].filter((b) => b.parcelId === parcelId); }
  async markBillPaidAndAdvance({ billId, ledgerTxId, idempotencyKey, parcelId, fromStatus, toStatus }) {
    const bill = this.bills.get(billId);
    if (!bill || bill.status !== "payable") return null;
    bill.status = "paid"; bill.ledgerTxId = ledgerTxId; bill.paidAt = new Date().toISOString();
    const parcel = this.parcels.get(parcelId);
    if (parcel && parcel.status === fromStatus) parcel.status = toStatus;
    return { bill, parcel };
  }
  async cancelParcelAndRelease({ parcelId, expectedStatuses }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (!expectedStatuses.includes(parcel.status)) return { conflict: true, status: parcel.status };
    const live = this.items.filter((it) => it.parcelId === parcelId && !it.releasedAt);
    for (const it of live) {
      it.releasedAt = new Date().toISOString();
      const unit = [...this.inventory.values()].find((u) => u.id === it.inventoryUnitId);
      if (unit && unit.status === "reserved") unit.status = "in_stock";
    }
    const refundBills = [];
    for (const b of this.bills.values()) {
      if (b.parcelId !== parcelId) continue;
      if (b.status === "paid") { b.status = "refund_pending"; refundBills.push(b); }
      else if (["draft", "payable"].includes(b.status)) { b.status = "cancelled"; }
    }
    parcel.status = "cancelled"; parcel.cancelledAt = new Date().toISOString();
    return { parcel, itemOrderIds: live.map((it) => it.itemOrderId), refundBills };
  }
  async markBillRefunded({ billId }) {
    const bill = this.bills.get(billId);
    if (!bill || bill.status !== "refund_pending") return null;
    bill.status = "refunded";
    return bill;
  }

  async acceptForPicking({ parcelId, expectedStatus }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (parcel.status !== expectedStatus) return { conflict: true, status: parcel.status };
    parcel.status = "picking";
    let task = this.pickingTasks.get(parcelId);
    if (!task) { task = { id: randomUUID(), parcelId, status: "pending", assigneeAdminId: null, claimedAt: null, completedAt: null, createdAt: new Date().toISOString() }; this.pickingTasks.set(parcelId, task); }
    return { parcel, task };
  }
  async findPickingTaskByParcel(parcelId) { return this.pickingTasks.get(parcelId) || null; }
  async claimPickingTask(parcelId, adminId) {
    const task = this.pickingTasks.get(parcelId);
    if (!task || task.status !== "pending") return null;
    task.status = "claimed"; task.assigneeAdminId = adminId; task.claimedAt = new Date().toISOString();
    return task;
  }
  async scanPickItem({ parcelId, stockNo, adminId }) {
    const unit = [...this.inventory.values()].find((u) => u.stockNo === stockNo);
    const item = this.items.find((it) => it.parcelId === parcelId && !it.releasedAt && unit && it.inventoryUnitId === unit.id);
    if (!item) return { foreign: true };
    const replay = Boolean(item.pickedAt);
    if (!replay) {
      item.pickedAt = new Date().toISOString(); item.pickedByAdminId = adminId;
      const task = this.pickingTasks.get(parcelId);
      if (task && ["pending", "claimed"].includes(task.status)) { task.status = "in_progress"; task.assigneeAdminId = task.assigneeAdminId || adminId; }
    }
    const live = this.items.filter((it) => it.parcelId === parcelId && !it.releasedAt);
    return { replay, stockNo, total: live.length, picked: live.filter((it) => it.pickedAt).length };
  }
  async pickingProgress(parcelId) {
    const live = this.items.filter((it) => it.parcelId === parcelId && !it.releasedAt);
    return { total: live.length, picked: live.filter((it) => it.pickedAt).length };
  }

  async recordOutboundEvidence({ parcelId, expectedStatus, sealPhotoKeys, labelKey, outboundPhotoKeys, adminId }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (parcel.status !== expectedStatus) return { conflict: true, status: parcel.status };
    const record = { id: randomUUID(), parcelId, sealPhotoKeys: sealPhotoKeys || [], labelKey: labelKey || "", outboundPhotoKeys: outboundPhotoKeys || [], recordedByAdminId: adminId, createdAt: new Date().toISOString() };
    this.outboundRecords.set(parcelId, record);
    parcel.status = "outbound";
    return { parcel, record };
  }
  async findOutboundRecord(parcelId) { return this.outboundRecords.get(parcelId) || null; }

  async findParcelVasById(parcelId, parcelVasId) {
    return this.parcelVas.find((v) => v.id === parcelVasId && v.parcelId === parcelId) || null;
  }
  async markVasExecuted({ parcelVasId, photoKeys, adminId }) {
    const v = this.parcelVas.find((x) => x.id === parcelVasId);
    if (!v) return null;
    v.status = "done"; v.photoKeys = photoKeys || []; v.executedByAdminId = adminId; v.executedAt = new Date().toISOString();
    return v;
  }
  async countPendingPhotoVas(parcelId) {
    return this.parcelVas.filter((v) => v.parcelId === parcelId && v.requiresPhoto && v.status !== "done").length;
  }
  async finalizeMeasurementWithBill({ parcelId, expectedStatus, routeId, finalWeightGrams, chargeableWeightGrams, dimensions, billNo, totalMinor, breakdown }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (parcel.status !== expectedStatus) return { conflict: true, status: parcel.status };
    const bill = { id: randomUUID(), billNo, parcelId, userId: parcel.userId, kind: "shipping", status: "payable", subtotalCnyMinor: totalMinor, membershipDiscountCnyMinor: 0, couponDiscountCnyMinor: 0, couponCode: "", totalCnyMinor: totalMinor, breakdown: breakdown || {}, ledgerTxId: null, refundLedgerTxId: null, paidAt: null, createdAt: new Date().toISOString() };
    this.bills.set(bill.id, bill);
    parcel.status = "shipping_fee_due"; parcel.routeId = routeId || null; parcel.finalWeightGrams = finalWeightGrams;
    parcel.chargeableWeightGrams = chargeableWeightGrams; parcel.dimensions = dimensions || {}; parcel.shippingFeeBillId = bill.id;
    return { parcel, bill };
  }
  async startPacking({ parcelId, expectedStatus }) {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { notFound: true };
    if (parcel.status !== expectedStatus) return { conflict: true, status: parcel.status };
    const live = this.items.filter((it) => it.parcelId === parcelId && !it.releasedAt);
    const picked = live.filter((it) => it.pickedAt).length;
    if (picked < live.length) return { incomplete: true, total: live.length, picked };
    parcel.status = "packing"; parcel.packingStartedAt = new Date().toISOString();
    const task = this.pickingTasks.get(parcelId);
    if (task) { task.status = "completed"; task.completedAt = new Date().toISOString(); }
    return { parcel, task };
  }
}
