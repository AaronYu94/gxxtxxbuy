import { getDbPool } from "../db/pool.js";

// V2-07-04/05/06/07 — consolidation parcels, stock reservation, address snapshot,
// and the value-added-service catalog.
export function createPgConsolidationRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- V2-07-07 value-added service catalog ----
    async createValueAddedService(input) {
      const row = (await pool().query(
        `insert into value_added_services (code, name, description, price_cny_minor, requires_photo, enabled, created_by_admin_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [input.code, input.name || "", input.description || "", input.priceCnyMinor ?? 0,
         Boolean(input.requiresPhoto), input.enabled !== false, input.adminUserId || null]
      )).rows[0];
      return normalizeVas(row);
    },
    async updateValueAddedService(id, patch) {
      const row = (await pool().query(
        `update value_added_services set
           name = coalesce($2, name), description = coalesce($3, description),
           price_cny_minor = coalesce($4, price_cny_minor), requires_photo = coalesce($5, requires_photo),
           enabled = coalesce($6, enabled)
         where id = $1 returning *`,
        [id, patch.name ?? null, patch.description ?? null,
         patch.priceCnyMinor ?? null, patch.requiresPhoto ?? null, patch.enabled ?? null]
      )).rows[0];
      return normalizeVas(row);
    },
    async listValueAddedServices({ enabledOnly = false } = {}) {
      const result = await pool().query(
        `select * from value_added_services where ($1::boolean is false or enabled) order by code asc`,
        [enabledOnly]
      );
      return result.rows.map(normalizeVas);
    },
    async findVasById(id) {
      const result = await pool().query("select * from value_added_services where id = $1", [id]);
      return normalizeVas(result.rows[0]);
    },
    async findVasByCodes(codes) {
      const result = await pool().query("select * from value_added_services where code = any($1::text[])", [codes]);
      return result.rows.map(normalizeVas);
    },

    // ---- V2-07-04 eligible-for-consolidation stock ----
    // A unit is eligible when it is officially warehoused (in_stock), owned by the
    // user, and not already live in another parcel.
    async listEligibleStock(userId) {
      const result = await pool().query(
        `select iu.*
           from inventory_units iu
           where iu.user_id = $1 and iu.status = 'in_stock'
             and not exists (
               select 1 from consolidation_parcel_items pi
               where pi.inventory_unit_id = iu.id and pi.released_at is null
             )
           order by iu.official_inbound_at asc`,
        [userId]
      );
      return result.rows.map(normalizeInventory);
    },

    async findParcelById(id) {
      const result = await pool().query("select * from consolidation_parcels where id = $1", [id]);
      return normalizeParcel(result.rows[0]);
    },
    async listParcelsByUser(userId) {
      const result = await pool().query(
        "select * from consolidation_parcels where user_id = $1 order by created_at desc", [userId]
      );
      return result.rows.map(normalizeParcel);
    },
    async listParcelItems(parcelId, { liveOnly = true } = {}) {
      const result = await pool().query(
        `select pi.*, iu.stock_no from consolidation_parcel_items pi
           join inventory_units iu on iu.id = pi.inventory_unit_id
           where pi.parcel_id = $1 and ($2::boolean is false or pi.released_at is null)
           order by pi.created_at asc`,
        [parcelId, liveOnly]
      );
      return result.rows.map(normalizeParcelItem);
    },
    async listParcelVas(parcelId) {
      const result = await pool().query(
        "select * from parcel_value_added_services where parcel_id = $1 order by created_at asc", [parcelId]
      );
      return result.rows.map(normalizeParcelVas);
    },

    // ---- V2-07-05/06 create a draft parcel and reserve its units atomically ----
    // Each unit is row-locked and re-checked; the partial unique index on
    // parcel_items is the final guard against a concurrent double-reservation.
    async createParcelWithReservation({ userId, addressId, recipientSnapshot, destinationCountry, parcelNo, stockNos, valueAddedServices = [] }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const units = [];
        for (const stockNo of stockNos) {
          const unit = (await client.query(
            "select * from inventory_units where stock_no = $1 for update", [stockNo]
          )).rows[0];
          if (!unit) { const e = new Error("unit_not_found"); e.code = "UNIT_NOT_FOUND"; e.stockNo = stockNo; throw e; }
          if (unit.user_id !== userId) { const e = new Error("not_owner"); e.code = "UNIT_NOT_OWNED"; e.stockNo = stockNo; throw e; }
          if (unit.status !== "in_stock") { const e = new Error("not_in_stock"); e.code = "UNIT_NOT_ELIGIBLE"; e.stockNo = stockNo; throw e; }
          units.push(unit);
        }
        const parcel = (await client.query(
          `insert into consolidation_parcels (parcel_no, user_id, address_id, recipient_snapshot, destination_country, status)
           values ($1, $2, $3, $4, $5, 'draft') returning *`,
          [parcelNo, userId, addressId || null, JSON.stringify(recipientSnapshot || {}), destinationCountry || ""]
        )).rows[0];
        for (const unit of units) {
          try {
            await client.query(
              "insert into consolidation_parcel_items (parcel_id, inventory_unit_id, item_order_id) values ($1, $2, $3)",
              [parcel.id, unit.id, unit.item_order_id]
            );
          } catch (error) {
            if (error.code === "23505") { const e = new Error("already_reserved"); e.code = "UNIT_ALREADY_RESERVED"; e.stockNo = unit.stock_no; throw e; }
            throw error;
          }
          await client.query("update inventory_units set status = 'reserved' where id = $1", [unit.id]);
        }
        for (const vas of valueAddedServices) {
          await client.query(
            `insert into parcel_value_added_services (parcel_id, value_added_service_id, code, name, price_cny_minor, requires_photo)
             values ($1, $2, $3, $4, $5, $6)`,
            [parcel.id, vas.id, vas.code, vas.name, vas.priceCnyMinor, vas.requiresPhoto]
          );
        }
        await client.query("commit");
        return { parcel: normalizeParcel(parcel), itemOrderIds: units.map((u) => u.item_order_id) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-07-08/09 packing-fee bill + parcel submit ----
    // Move a draft parcel to packing_fee_due and create its packing bill in one
    // transaction (guarded on the current status, so a double-submit is a no-op).
    async submitParcelWithBill({ parcelId, expectedStatus, billNo, subtotalMinor, membershipDiscountMinor, couponDiscountMinor, couponCode, totalMinor, breakdown }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (parcel.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }
        const bill = (await client.query(
          `insert into parcel_bills (bill_no, parcel_id, user_id, kind, status, subtotal_cny_minor, membership_discount_cny_minor, coupon_discount_cny_minor, coupon_code, total_cny_minor, breakdown)
           values ($1, $2, $3, 'packing', 'payable', $4, $5, $6, $7, $8, $9) returning *`,
          [billNo, parcelId, parcel.user_id, subtotalMinor, membershipDiscountMinor, couponDiscountMinor, couponCode || "", totalMinor, JSON.stringify(breakdown || {})]
        )).rows[0];
        const updated = (await client.query(
          "update consolidation_parcels set status = 'packing_fee_due', packing_fee_bill_id = $2 where id = $1 returning *",
          [parcelId, bill.id]
        )).rows[0];
        await client.query("commit");
        return { parcel: normalizeParcel(updated), bill: normalizeBill(bill) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findBillById(id) {
      const result = await pool().query("select * from parcel_bills where id = $1", [id]);
      return normalizeBill(result.rows[0]);
    },
    async findActiveBill(parcelId, kind) {
      const result = await pool().query(
        "select * from parcel_bills where parcel_id = $1 and kind = $2 and status <> 'cancelled' order by created_at desc limit 1",
        [parcelId, kind]
      );
      return normalizeBill(result.rows[0]);
    },
    async listBillsByParcel(parcelId) {
      const result = await pool().query("select * from parcel_bills where parcel_id = $1 order by created_at asc", [parcelId]);
      return result.rows.map(normalizeBill);
    },

    // Mark a bill paid (guarded on payable) and advance the parcel. Returns null if
    // the bill was not payable (already paid / cancelled).
    async markBillPaidAndAdvance({ billId, ledgerTxId, idempotencyKey, parcelId, fromStatus, toStatus }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const bill = (await client.query(
          "update parcel_bills set status = 'paid', ledger_tx_id = $2, idempotency_key = $3, paid_at = now() where id = $1 and status = 'payable' returning *",
          [billId, ledgerTxId, idempotencyKey || null]
        )).rows[0];
        if (!bill) { await client.query("rollback"); return null; }
        const parcel = (await client.query(
          "update consolidation_parcels set status = $3 where id = $1 and status = $2 returning *",
          [parcelId, fromStatus, toStatus]
        )).rows[0];
        await client.query("commit");
        return { bill: normalizeBill(bill), parcel: normalizeParcel(parcel) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-07-10 pre-packing cancel: release reservation, void/refund bills ----
    async cancelParcelAndRelease({ parcelId, expectedStatuses }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (!expectedStatuses.includes(parcel.status)) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }

        // Release each live reservation and return its unit to stock.
        const items = (await client.query(
          "select * from consolidation_parcel_items where parcel_id = $1 and released_at is null", [parcelId]
        )).rows;
        for (const it of items) {
          await client.query("update consolidation_parcel_items set released_at = now() where id = $1", [it.id]);
          await client.query("update inventory_units set status = 'in_stock' where id = $1 and status = 'reserved'", [it.inventory_unit_id]);
        }
        // A never-paid packing bill is simply voided; a paid one is flagged for refund.
        const paidBills = (await client.query(
          "update parcel_bills set status = case when status = 'paid' then 'refund_pending' else 'cancelled' end where parcel_id = $1 and status in ('draft','payable','paid') returning *",
          [parcelId]
        )).rows;
        const updated = (await client.query(
          "update consolidation_parcels set status = 'cancelled', cancelled_at = now() where id = $1 returning *", [parcelId]
        )).rows[0];
        await client.query("commit");
        return {
          parcel: normalizeParcel(updated),
          itemOrderIds: items.map((it) => it.item_order_id),
          refundBills: paidBills.filter((b) => b.status === "refund_pending").map(normalizeBill)
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markBillRefunded({ billId, refundLedgerTxId }) {
      const result = await pool().query(
        "update parcel_bills set status = 'refunded', refund_ledger_tx_id = $2 where id = $1 and status = 'refund_pending' returning *",
        [billId, refundLedgerTxId || null]
      );
      return normalizeBill(result.rows[0]);
    },

    // ---- V2-07-11 accept for picking (warehouse_acceptance_pending → picking) ----
    async acceptForPicking({ parcelId, expectedStatus }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (parcel.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }
        const updated = (await client.query(
          "update consolidation_parcels set status = 'picking' where id = $1 returning *", [parcelId]
        )).rows[0];
        const task = (await client.query(
          `insert into picking_tasks (parcel_id, status) values ($1, 'pending')
           on conflict (parcel_id) do update set parcel_id = excluded.parcel_id returning *`,
          [parcelId]
        )).rows[0];
        await client.query("commit");
        return { parcel: normalizeParcel(updated), task: normalizePickingTask(task) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async findPickingTaskByParcel(parcelId) {
      const result = await pool().query("select * from picking_tasks where parcel_id = $1", [parcelId]);
      return normalizePickingTask(result.rows[0]);
    },
    // Only one operator wins the claim (guarded on pending).
    async claimPickingTask(parcelId, adminId) {
      const result = await pool().query(
        "update picking_tasks set status = 'claimed', assignee_admin_id = $2, claimed_at = now() where parcel_id = $1 and status = 'pending' returning *",
        [parcelId, adminId]
      );
      return normalizePickingTask(result.rows[0]);
    },

    // ---- V2-07-12 scan one unit into the parcel ----
    async scanPickItem({ parcelId, stockNo, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const row = (await client.query(
          `select pi.* from consolidation_parcel_items pi
             join inventory_units iu on iu.id = pi.inventory_unit_id
             where pi.parcel_id = $1 and iu.stock_no = $2 and pi.released_at is null for update`,
          [parcelId, stockNo]
        )).rows[0];
        if (!row) { await client.query("rollback"); return { foreign: true }; }
        const replay = Boolean(row.picked_at);
        if (!replay) {
          await client.query("update consolidation_parcel_items set picked_at = now(), picked_by_admin_id = $2 where id = $1", [row.id, adminId]);
          await client.query("update picking_tasks set status = 'in_progress', assignee_admin_id = coalesce(assignee_admin_id, $2) where parcel_id = $1 and status in ('pending','claimed')", [parcelId, adminId]);
        }
        const prog = (await client.query(
          `select count(*)::int total, count(picked_at)::int picked
             from consolidation_parcel_items where parcel_id = $1 and released_at is null`,
          [parcelId]
        )).rows[0];
        await client.query("commit");
        return { replay, stockNo, total: prog.total, picked: prog.picked };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    // ---- V2-07-14 value-added-service execution ----
    async findParcelVasById(parcelId, parcelVasId) {
      const result = await pool().query(
        "select * from parcel_value_added_services where id = $1 and parcel_id = $2", [parcelVasId, parcelId]
      );
      return normalizeParcelVas(result.rows[0]);
    },
    async markVasExecuted({ parcelVasId, photoKeys, adminId }) {
      const result = await pool().query(
        `update parcel_value_added_services set status = 'done', photo_keys = $2, executed_by_admin_id = $3, executed_at = now()
         where id = $1 returning *`,
        [parcelVasId, JSON.stringify(photoKeys || []), adminId || null]
      );
      return normalizeParcelVas(result.rows[0]);
    },
    async countPendingPhotoVas(parcelId) {
      const r = (await pool().query(
        "select count(*)::int n from parcel_value_added_services where parcel_id = $1 and requires_photo and status <> 'done'",
        [parcelId]
      )).rows[0];
      return r.n;
    },

    // ---- V2-07-15 final measurement + international shipping bill ----
    async finalizeMeasurementWithBill({ parcelId, expectedStatus, routeId, finalWeightGrams, chargeableWeightGrams, dimensions, billNo, totalMinor, breakdown }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (parcel.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }
        const bill = (await client.query(
          `insert into parcel_bills (bill_no, parcel_id, user_id, kind, status, subtotal_cny_minor, total_cny_minor, breakdown)
           values ($1, $2, $3, 'shipping', 'payable', $4, $4, $5) returning *`,
          [billNo, parcelId, parcel.user_id, totalMinor, JSON.stringify(breakdown || {})]
        )).rows[0];
        const updated = (await client.query(
          `update consolidation_parcels set status = 'shipping_fee_due', route_id = $2, final_weight_grams = $3,
             chargeable_weight_grams = $4, dimensions = $5, shipping_fee_bill_id = $6 where id = $1 returning *`,
          [parcelId, routeId || null, finalWeightGrams, chargeableWeightGrams, JSON.stringify(dimensions || {}), bill.id]
        )).rows[0];
        await client.query("commit");
        return { parcel: normalizeParcel(updated), bill: normalizeBill(bill) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-07-17 seal / label / outbound evidence ----
    async recordOutboundEvidence({ parcelId, expectedStatus, sealPhotoKeys, labelKey, outboundPhotoKeys, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (parcel.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }
        const record = (await client.query(
          `insert into parcel_outbound_records (parcel_id, seal_photo_keys, label_key, outbound_photo_keys, recorded_by_admin_id)
           values ($1, $2, $3, $4, $5)
           on conflict (parcel_id) do update set seal_photo_keys = excluded.seal_photo_keys, label_key = excluded.label_key,
             outbound_photo_keys = excluded.outbound_photo_keys, recorded_by_admin_id = excluded.recorded_by_admin_id returning *`,
          [parcelId, JSON.stringify(sealPhotoKeys || []), labelKey || "", JSON.stringify(outboundPhotoKeys || []), adminId || null]
        )).rows[0];
        const updated = (await client.query(
          "update consolidation_parcels set status = 'outbound' where id = $1 returning *", [parcelId]
        )).rows[0];
        await client.query("commit");
        return { parcel: normalizeParcel(updated), record: normalizeOutboundRecord(record) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async findOutboundRecord(parcelId) {
      const result = await pool().query("select * from parcel_outbound_records where parcel_id = $1", [parcelId]);
      return normalizeOutboundRecord(result.rows[0]);
    },

    async pickingProgress(parcelId) {
      const r = (await pool().query(
        "select count(*)::int total, count(picked_at)::int picked from consolidation_parcel_items where parcel_id = $1 and released_at is null",
        [parcelId]
      )).rows[0];
      return { total: r.total, picked: r.picked };
    },

    // ---- V2-07-13 review + start packing (picking → packing; the lock point) ----
    async startPacking({ parcelId, expectedStatus }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parcel = (await client.query("select * from consolidation_parcels where id = $1 for update", [parcelId])).rows[0];
        if (!parcel) { await client.query("rollback"); return { notFound: true }; }
        if (parcel.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: parcel.status }; }
        const prog = (await client.query(
          "select count(*)::int total, count(picked_at)::int picked from consolidation_parcel_items where parcel_id = $1 and released_at is null",
          [parcelId]
        )).rows[0];
        if (prog.picked < prog.total) { await client.query("rollback"); return { incomplete: true, total: prog.total, picked: prog.picked }; }
        const updated = (await client.query(
          "update consolidation_parcels set status = 'packing', packing_started_at = now() where id = $1 returning *", [parcelId]
        )).rows[0];
        const task = (await client.query(
          "update picking_tasks set status = 'completed', completed_at = now() where parcel_id = $1 returning *", [parcelId]
        )).rows[0];
        await client.query("commit");
        return { parcel: normalizeParcel(updated), task: normalizePickingTask(task) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // V2-11-07 — the commission base for a signed parcel: its owner (the invitee)
    // and the international shipping the user actually paid (the frozen base).
    async commissionBaseForParcel(parcelId) {
      const r = await pool().query(
        `select cp.user_id, coalesce((select b.total_cny_minor from parcel_bills b where b.parcel_id = cp.id and b.kind = 'shipping' and b.status = 'paid' order by b.created_at desc limit 1), 0) base_minor
           from consolidation_parcels cp where cp.id = $1`,
        [parcelId]
      );
      const row = r.rows[0];
      return row ? { userId: row.user_id, baseMinor: Number(row.base_minor) } : null;
    }
  };
}

export function normalizeOutboundRecord(row) {
  if (!row) return null;
  return {
    id: row.id, parcelId: row.parcel_id, sealPhotoKeys: row.seal_photo_keys || [], labelKey: row.label_key,
    outboundPhotoKeys: row.outbound_photo_keys || [], recordedByAdminId: row.recorded_by_admin_id, createdAt: row.created_at
  };
}

export function normalizePickingTask(row) {
  if (!row) return null;
  return {
    id: row.id, parcelId: row.parcel_id, status: row.status, assigneeAdminId: row.assignee_admin_id,
    claimedAt: row.claimed_at, completedAt: row.completed_at, createdAt: row.created_at
  };
}

export function normalizeBill(row) {
  if (!row) return null;
  return {
    id: row.id, billNo: row.bill_no, parcelId: row.parcel_id, userId: row.user_id, kind: row.kind, status: row.status,
    subtotalCnyMinor: Number(row.subtotal_cny_minor), membershipDiscountCnyMinor: Number(row.membership_discount_cny_minor),
    couponDiscountCnyMinor: Number(row.coupon_discount_cny_minor), couponCode: row.coupon_code,
    totalCnyMinor: Number(row.total_cny_minor), breakdown: row.breakdown || {}, ledgerTxId: row.ledger_tx_id,
    refundLedgerTxId: row.refund_ledger_tx_id, paidAt: row.paid_at, createdAt: row.created_at
  };
}

export function normalizeVas(row) {
  if (!row) return null;
  return {
    id: row.id, code: row.code, name: row.name, description: row.description,
    priceCnyMinor: Number(row.price_cny_minor), requiresPhoto: row.requires_photo,
    enabled: row.enabled, createdAt: row.created_at
  };
}

export function normalizeParcel(row) {
  if (!row) return null;
  return {
    id: row.id, parcelNo: row.parcel_no, userId: row.user_id, addressId: row.address_id,
    recipientSnapshot: row.recipient_snapshot || {}, destinationCountry: row.destination_country,
    routeId: row.route_id, status: row.status,
    packingFeeBillId: row.packing_fee_bill_id, shippingFeeBillId: row.shipping_fee_bill_id,
    declaredWeightGrams: row.declared_weight_grams, finalWeightGrams: row.final_weight_grams,
    chargeableWeightGrams: row.chargeable_weight_grams, dimensions: row.dimensions || {},
    trackingNo: row.tracking_no, outboundBatchId: row.outbound_batch_id, version: row.version,
    packingStartedAt: row.packing_started_at, cancelledAt: row.cancelled_at, createdAt: row.created_at
  };
}

export function normalizeParcelItem(row) {
  if (!row) return null;
  return {
    id: row.id, parcelId: row.parcel_id, inventoryUnitId: row.inventory_unit_id,
    itemOrderId: row.item_order_id, stockNo: row.stock_no, releasedAt: row.released_at,
    pickedAt: row.picked_at ?? null, createdAt: row.created_at
  };
}

export function normalizeParcelVas(row) {
  if (!row) return null;
  return {
    id: row.id, parcelId: row.parcel_id, valueAddedServiceId: row.value_added_service_id,
    code: row.code, name: row.name, priceCnyMinor: Number(row.price_cny_minor),
    requiresPhoto: row.requires_photo, status: row.status, photoKeys: row.photo_keys || [],
    executedAt: row.executed_at, createdAt: row.created_at
  };
}

function normalizeInventory(row) {
  if (!row) return null;
  return {
    id: row.id, stockNo: row.stock_no, itemOrderId: row.item_order_id, userId: row.user_id,
    status: row.status, officialInboundAt: row.official_inbound_at, returnDeadlineAt: row.return_deadline_at,
    locationId: row.location_id, paidExtensionMonths: row.paid_extension_months ?? 0, createdAt: row.created_at
  };
}
