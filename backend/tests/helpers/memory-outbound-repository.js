import { randomUUID } from "node:crypto";

// In-memory double for the outbound repository (V2-07-18/19/20).
// Parcels are shared with the consolidation memory repo via a plain Map the test
// seeds; here we only need id/status/tracking_no/outbound_batch_id.
export class MemoryOutboundRepository {
  constructor({ parcels = new Map(), carriers = new Map() } = {}) {
    this.batches = new Map();        // id -> batch
    this.batchParcels = [];          // membership rows
    this.parcels = parcels;          // id -> { id, status, trackingNo, outboundBatchId, parcelNo }
    this.carriers = carriers;        // code -> { id }
  }

  seedParcel(p) {
    const parcel = { id: p.id || randomUUID(), parcelNo: p.parcelNo || `GO-PKG-${Math.floor(Math.random() * 1e6)}`, status: p.status || "outbound", trackingNo: "", outboundBatchId: null };
    this.parcels.set(parcel.id, parcel);
    return parcel;
  }

  async findCarrierByCode(code) { return this.carriers.get(code) || null; }
  async createBatch({ batchNo, carrierId, adminId }) {
    const batch = { id: randomUUID(), batchNo, carrierId: carrierId || null, status: "draft", handoffEvidence: [], handedOffAt: null, createdByAdminId: adminId, createdAt: new Date().toISOString() };
    this.batches.set(batch.id, batch);
    return batch;
  }
  async findBatchById(id) { return this.batches.get(id) || null; }
  async listBatches({ status = null } = {}) { return [...this.batches.values()].filter((b) => !status || b.status === status); }
  async listBatchParcels(batchId) {
    return this.batchParcels.filter((bp) => bp.batchId === batchId).map((bp) => {
      const p = this.parcels.get(bp.parcelId);
      return { ...bp, parcelNo: p?.parcelNo, parcelStatus: p?.status };
    });
  }
  async loadParcel({ batchId, parcelId }) {
    const batch = this.batches.get(batchId);
    if (!batch) { const e = new Error("no_batch"); e.code = "BATCH_NOT_FOUND"; throw e; }
    if (!["draft", "loading"].includes(batch.status)) { const e = new Error("closed"); e.code = "BATCH_CLOSED"; throw e; }
    const parcel = this.parcels.get(parcelId);
    if (!parcel) { const e = new Error("no_parcel"); e.code = "PARCEL_NOT_FOUND"; throw e; }
    if (parcel.status !== "outbound") { const e = new Error("not_outbound"); e.code = "PARCEL_NOT_OUTBOUND"; e.status = parcel.status; throw e; }
    if (parcel.outboundBatchId && parcel.outboundBatchId !== batchId) { const e = new Error("in_batch"); e.code = "PARCEL_IN_BATCH"; throw e; }
    if (!this.batchParcels.some((bp) => bp.batchId === batchId && bp.parcelId === parcelId)) {
      this.batchParcels.push({ id: randomUUID(), batchId, parcelId, trackingNo: "", loadedAt: new Date().toISOString() });
    }
    parcel.outboundBatchId = batchId;
    if (batch.status === "draft") batch.status = "loading";
    return { batch };
  }
  async markHandoffPending(batchId) {
    const b = this.batches.get(batchId);
    if (!b || b.status !== "loading") return null;
    b.status = "handoff_pending";
    return b;
  }
  async confirmHandoff({ batchId, evidence, trackingByParcel }) {
    const b = this.batches.get(batchId);
    if (!b) return { notFound: true };
    if (b.status !== "handoff_pending") return { conflict: true, status: b.status };
    const rows = this.batchParcels.filter((bp) => bp.batchId === batchId);
    for (const bp of rows) {
      const t = trackingByParcel[bp.parcelId] || "";
      bp.trackingNo = t;
      const p = this.parcels.get(bp.parcelId);
      if (p && p.status === "outbound") { p.status = "in_transit"; p.trackingNo = t; }
    }
    b.status = "handed_off"; b.handoffEvidence = evidence || []; b.handedOffAt = new Date().toISOString();
    return { batch: b, parcelIds: rows.map((r) => r.parcelId) };
  }
  async completeBatch(batchId) {
    const b = this.batches.get(batchId);
    if (!b || b.status !== "handed_off") return null;
    b.status = "completed";
    return b;
  }
  async cancelBatch(batchId) {
    const b = this.batches.get(batchId);
    if (!b) return { notFound: true };
    if (!["draft", "loading"].includes(b.status)) return { conflict: true, status: b.status };
    for (const p of this.parcels.values()) if (p.outboundBatchId === batchId) p.outboundBatchId = null;
    b.status = "cancelled";
    return { batch: b };
  }
  async findParcelById(id) { const p = this.parcels.get(id); return p ? { id: p.id, status: p.status, tracking_no: p.trackingNo } : null; }
  async advanceParcelTracking({ parcelId, fromStatus, toStatus }) {
    const p = this.parcels.get(parcelId);
    if (!p || p.status !== fromStatus) return null;
    p.status = toStatus;
    return { id: p.id, status: p.status };
  }
}
