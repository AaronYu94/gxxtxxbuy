import { getDbPool } from "../db/pool.js";

// V2-07-18/19/20 — outbound batches, handoff + tracking writeback, tracking sync.
export function createPgOutboundRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async findCarrierByCode(code) {
      const r = await pool().query("select id from carriers where code = $1", [code]);
      return r.rows[0] || null;
    },
    async createBatch({ batchNo, carrierId, adminId }) {
      const row = (await pool().query(
        "insert into outbound_batches (batch_no, carrier_id, status, created_by_admin_id) values ($1, $2, 'draft', $3) returning *",
        [batchNo, carrierId || null, adminId || null]
      )).rows[0];
      return normalizeBatch(row);
    },
    async findBatchById(id) {
      const r = await pool().query("select * from outbound_batches where id = $1", [id]);
      return normalizeBatch(r.rows[0]);
    },
    async listBatches({ status = null } = {}) {
      const r = await pool().query(
        "select * from outbound_batches where ($1::text is null or status = $1) order by created_at desc", [status]
      );
      return r.rows.map(normalizeBatch);
    },
    async listBatchParcels(batchId) {
      const r = await pool().query(
        `select bp.*, cp.parcel_no, cp.status parcel_status from outbound_batch_parcels bp
           join consolidation_parcels cp on cp.id = bp.parcel_id
           where bp.batch_id = $1 order by bp.loaded_at asc`,
        [batchId]
      );
      return r.rows.map(normalizeBatchParcel);
    },

    // ---- V2-07-18 load an outbound parcel into a batch ----
    async loadParcel({ batchId, parcelId, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const batch = (await client.query("select * from outbound_batches where id = $1 for update", [batchId])).rows[0];
        if (!batch) { await client.query("rollback"); const e = new Error("no_batch"); e.code = "BATCH_NOT_FOUND"; throw e; }
        if (!["draft", "loading"].includes(batch.status)) { await client.query("rollback"); const e = new Error("closed"); e.code = "BATCH_CLOSED"; throw e; }
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); const e = new Error("no_parcel"); e.code = "PARCEL_NOT_FOUND"; throw e; }
        if (parcel.status !== "outbound") { await client.query("rollback"); const e = new Error("not_outbound"); e.code = "PARCEL_NOT_OUTBOUND"; e.status = parcel.status; throw e; }
        // A parcel may be in at most one non-terminal batch.
        if (parcel.outbound_batch_id && parcel.outbound_batch_id !== batchId) { await client.query("rollback"); const e = new Error("in_batch"); e.code = "PARCEL_IN_BATCH"; throw e; }
        await client.query(
          "insert into outbound_batch_parcels (batch_id, parcel_id) values ($1, $2) on conflict (batch_id, parcel_id) do nothing",
          [batchId, parcelId]
        );
        await client.query("update consolidation_parcels set outbound_batch_id = $2 where id = $1", [parcelId, batchId]);
        const updatedBatch = (await client.query(
          "update outbound_batches set status = 'loading' where id = $1 and status = 'draft' returning *", [batchId]
        )).rows[0] || batch;
        await client.query("commit");
        return { batch: normalizeBatch(updatedBatch) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markHandoffPending(batchId) {
      const r = await pool().query(
        "update outbound_batches set status = 'handoff_pending' where id = $1 and status = 'loading' returning *", [batchId]
      );
      return normalizeBatch(r.rows[0]);
    },

    // ---- V2-07-19 confirm handoff + tracking-number writeback ----
    async confirmHandoff({ batchId, evidence, trackingByParcel }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const batch = (await client.query("select * from outbound_batches where id = $1 for update", [batchId])).rows[0];
        if (!batch) { await client.query("rollback"); return { notFound: true }; }
        if (batch.status !== "handoff_pending") { await client.query("rollback"); return { conflict: true, status: batch.status }; }
        const parcels = (await client.query("select * from outbound_batch_parcels where batch_id = $1", [batchId])).rows;
        for (const bp of parcels) {
          const trackingNo = trackingByParcel[bp.parcel_id] || "";
          await client.query("update outbound_batch_parcels set tracking_no = $2 where id = $1", [bp.id, trackingNo]);
          // Writeback onto the parcel and advance outbound → in_transit.
          await client.query(
            "update consolidation_parcels set tracking_no = $2, status = 'in_transit' where id = $1 and status = 'outbound'",
            [bp.parcel_id, trackingNo]
          );
        }
        const updated = (await client.query(
          "update outbound_batches set status = 'handed_off', handoff_evidence = $2, handed_off_at = now() where id = $1 returning *",
          [batchId, JSON.stringify(evidence || [])]
        )).rows[0];
        await client.query("commit");
        return { batch: normalizeBatch(updated), parcelIds: parcels.map((p) => p.parcel_id) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async completeBatch(batchId) {
      const r = await pool().query(
        "update outbound_batches set status = 'completed' where id = $1 and status = 'handed_off' returning *", [batchId]
      );
      return normalizeBatch(r.rows[0]);
    },

    async cancelBatch(batchId) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const batch = (await client.query("select * from outbound_batches where id = $1 for update", [batchId])).rows[0];
        if (!batch) { await client.query("rollback"); return { notFound: true }; }
        if (!["draft", "loading"].includes(batch.status)) { await client.query("rollback"); return { conflict: true, status: batch.status }; }
        // Release each parcel's batch binding (they stay outbound, re-loadable).
        await client.query(
          "update consolidation_parcels set outbound_batch_id = null where outbound_batch_id = $1", [batchId]
        );
        const updated = (await client.query(
          "update outbound_batches set status = 'cancelled' where id = $1 returning *", [batchId]
        )).rows[0];
        await client.query("commit");
        return { batch: normalizeBatch(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-07-20 tracking sync ----
    async findParcelById(id) {
      const r = await pool().query("select id, status, tracking_no from consolidation_parcels where id = $1", [id]);
      return r.rows[0] || null;
    },
    async advanceParcelTracking({ parcelId, fromStatus, toStatus }) {
      const r = await pool().query(
        "update consolidation_parcels set status = $3 where id = $1 and status = $2 returning id, status",
        [parcelId, fromStatus, toStatus]
      );
      return r.rows[0] || null;
    }
  };
}

export function normalizeBatch(row) {
  if (!row) return null;
  return {
    id: row.id, batchNo: row.batch_no, carrierId: row.carrier_id, status: row.status,
    handoffEvidence: row.handoff_evidence || [], handedOffAt: row.handed_off_at,
    createdByAdminId: row.created_by_admin_id, createdAt: row.created_at
  };
}

export function normalizeBatchParcel(row) {
  if (!row) return null;
  return {
    id: row.id, batchId: row.batch_id, parcelId: row.parcel_id, parcelNo: row.parcel_no,
    parcelStatus: row.parcel_status, trackingNo: row.tracking_no, loadedAt: row.loaded_at
  };
}
