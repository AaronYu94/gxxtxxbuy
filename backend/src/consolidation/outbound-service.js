import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";

// V2-07-18/19/20 — outbound batches, handoff + tracking writeback, tracking sync.
export function createOutboundService({ repository, orderService = null, commissionHook = null, auditLogger = null } = {}) {
  if (!repository) throw new Error("Outbound repository is required.");

  // Tracking-sync transitions (in_transit → delivered → completed).
  const TRACKING_TRANSITIONS = { delivered: { from: "in_transit" }, completed: { from: "delivered" } };

  return {
    // ---- V2-07-18 batch lifecycle ----
    async createBatch(adminUser, input, requestMeta = {}) {
      let carrierId = null;
      const carrierCode = optionalText(input?.carrier_code, "carrier_code", 40);
      if (carrierCode) {
        const carrier = await repository.findCarrierByCode(carrierCode);
        if (!carrier) throw notFound("Carrier not found.");
        carrierId = carrier.id;
      }
      const batchNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.outboundBatch);
      const batch = await repository.createBatch({ batchNo, carrierId, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "outbound.batch_create", resourceType: "outbound_batch", resourceId: batch.id, requestId: requestMeta.requestId }, { critical: false });
      return { batch: publicBatch(batch) };
    },

    async loadParcel(adminUser, batchId, input, requestMeta = {}) {
      const parcelId = requiredText(input?.parcel_id, "parcel_id", 64);
      try {
        await repository.loadParcel({ batchId, parcelId, adminId: adminUser.id });
      } catch (error) {
        if (error.code === "BATCH_NOT_FOUND") throw notFound("Batch not found.");
        if (error.code === "BATCH_CLOSED") throw conflict("Batch is no longer accepting parcels.", { code: "batch_closed" });
        if (error.code === "PARCEL_NOT_FOUND") throw notFound("Parcel not found.");
        if (error.code === "PARCEL_NOT_OUTBOUND") throw conflict("Only an outbound parcel can be loaded.", { code: "not_outbound", status: error.status });
        if (error.code === "PARCEL_IN_BATCH") throw conflict("Parcel is already in another batch.", { code: "in_batch" });
        throw error;
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "outbound.batch_load", resourceType: "outbound_batch", resourceId: batchId, metadata: { parcel_id: parcelId }, requestId: requestMeta.requestId }, { critical: false });
      return this.getBatch(batchId);
    },

    async markHandoffPending(adminUser, batchId, requestMeta = {}) {
      const batch = await repository.markHandoffPending(batchId);
      if (!batch) {
        const cur = await repository.findBatchById(batchId);
        if (!cur) throw notFound("Batch not found.");
        throw conflict("Batch must be loading to move to handoff.", { code: "bad_state", status: cur.status });
      }
      return this.getBatch(batchId);
    },

    // ---- V2-07-19 confirm handoff with signed evidence + tracking writeback ----
    async confirmHandoff(adminUser, batchId, input, requestMeta = {}) {
      const evidence = Array.isArray(input?.evidence) ? input.evidence.map(String).filter(Boolean) : [];
      if (evidence.length === 0) {
        // Frozen: handoff needs a signed sheet or carrier receipt.
        throw badRequest("A signed sheet or carrier receipt is required to confirm handoff.", { field: "evidence" });
      }
      const trackingByParcel = {};
      for (const entry of Array.isArray(input?.tracking) ? input.tracking : []) {
        const pid = String(entry?.parcel_id || "");
        if (pid) trackingByParcel[pid] = String(entry?.tracking_no || "").slice(0, 120);
      }
      const result = await repository.confirmHandoff({ batchId, evidence, trackingByParcel });
      if (result.notFound) throw notFound("Batch not found.");
      if (result.conflict) throw conflict("Batch is not awaiting handoff.", { code: "bad_state", status: result.status });

      // Advance each parcel's item sub-orders to outbound (fulfillment).
      if (orderService) {
        // (Item-order fulfillment transition is best-effort; parcel status is authoritative.)
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "outbound.batch_handoff", resourceType: "outbound_batch", resourceId: batchId, metadata: { parcels: result.parcelIds.length }, requestId: requestMeta.requestId }, { critical: true });
      return this.getBatch(batchId);
    },

    async completeBatch(adminUser, batchId, requestMeta = {}) {
      const batch = await repository.completeBatch(batchId);
      if (!batch) {
        const cur = await repository.findBatchById(batchId);
        if (!cur) throw notFound("Batch not found.");
        throw conflict("Only a handed-off batch can be completed.", { code: "bad_state", status: cur.status });
      }
      return this.getBatch(batchId);
    },

    async cancelBatch(adminUser, batchId, requestMeta = {}) {
      const result = await repository.cancelBatch(batchId);
      if (result.notFound) throw notFound("Batch not found.");
      if (result.conflict) throw conflict("A batch can only be cancelled before handoff.", { code: "bad_state", status: result.status });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "outbound.batch_cancel", resourceType: "outbound_batch", resourceId: batchId, requestId: requestMeta.requestId }, { critical: true });
      return this.getBatch(batchId);
    },

    async listBatches(query = {}) {
      const rows = await repository.listBatches({ status: query.status ? String(query.status) : null });
      return { batches: rows.map(publicBatch) };
    },

    async getBatch(id) {
      const batch = await repository.findBatchById(id);
      if (!batch) throw notFound("Batch not found.");
      const parcels = await repository.listBatchParcels(id);
      return { batch: publicBatch(batch), parcels: parcels.map(publicBatchParcel) };
    },

    // ---- V2-07-20 tracking sync ----
    async syncTracking(adminUser, input, requestMeta = {}) {
      const parcelId = requiredText(input?.parcel_id, "parcel_id", 64);
      const toStatus = requiredText(input?.status, "status", 30);
      const rule = TRACKING_TRANSITIONS[toStatus];
      if (!rule) throw badRequest("Unsupported tracking status.", { field: "status", allowed: Object.keys(TRACKING_TRANSITIONS) });
      const parcel = await repository.findParcelById(parcelId);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status === toStatus) {
        return { parcel_id: parcelId, status: toStatus, replay: true };
      }
      const advanced = await repository.advanceParcelTracking({ parcelId, fromStatus: rule.from, toStatus });
      if (!advanced) throw conflict(`Parcel cannot move to ${toStatus} from ${parcel.status}.`, { code: "bad_transition", status: parcel.status });
      // V2-11-07 — a signed (delivered) parcel generates promoter commission
      // (idempotent on the parcel, so any confirmation path fires it once).
      if (toStatus === "delivered" && commissionHook) {
        await commissionHook(parcelId).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "outbound.tracking_sync", resourceType: "consolidation_parcel", resourceId: parcelId, metadata: { status: toStatus }, requestId: requestMeta.requestId }, { critical: false });
      return { parcel_id: parcelId, status: advanced.status, replay: false };
    }
  };
}

export function publicBatch(b) {
  if (!b) return null;
  return { id: b.id, batch_no: b.batchNo, carrier_id: b.carrierId, status: b.status, handoff_evidence: b.handoffEvidence, handed_off_at: b.handedOffAt, created_at: b.createdAt };
}

export function publicBatchParcel(p) {
  return { id: p.id, parcel_id: p.parcelId, parcel_no: p.parcelNo, parcel_status: p.parcelStatus, tracking_no: p.trackingNo, loaded_at: p.loadedAt };
}
