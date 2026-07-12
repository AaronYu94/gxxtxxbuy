import { getDbPool } from "../db/pool.js";
import { AFTER_SALES_ROLE } from "./after-sales-status.js";

// V2-08 — after-sales orders, immutable status history, and attachments.
export function createPgAfterSalesRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- V2-08-03 open a return: reserve the unit + open the order atomically ----
    async createReturn({ asNo, itemOrderId, inventoryUnitId, userId, reason, description, quantity, evidencePhotoKeys, deadlineAt, actor }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const unit = (await client.query("select * from inventory_units where id = $1 for update", [inventoryUnitId])).rows[0];
        if (!unit) { await client.query("rollback"); const e = new Error("no_unit"); e.code = "UNIT_NOT_FOUND"; throw e; }
        if (unit.user_id !== userId) { await client.query("rollback"); const e = new Error("not_owner"); e.code = "UNIT_NOT_OWNED"; throw e; }
        if (unit.status !== "in_stock") { await client.query("rollback"); const e = new Error("not_available"); e.code = "UNIT_NOT_AVAILABLE"; e.status = unit.status; throw e; }
        let order;
        try {
          order = (await client.query(
            `insert into after_sales_orders (as_no, item_order_id, inventory_unit_id, user_id, status, reason, description, quantity, current_owner_role, deadline_at)
             values ($1, $2, $3, $4, 'purchase_review_pending', $5, $6, $7, 'procurement', $8) returning *`,
            [asNo, itemOrderId, inventoryUnitId, userId, reason || "", description || "", quantity || 1, deadlineAt || null]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); const e = new Error("dup"); e.code = "AFTER_SALES_EXISTS"; throw e; }
          throw error;
        }
        await client.query("update inventory_units set status = 'return_reserved' where id = $1", [inventoryUnitId]);
        if (Array.isArray(evidencePhotoKeys) && evidencePhotoKeys.length > 0) {
          await client.query(
            "insert into after_sales_attachments (after_sales_id, kind, photo_keys, created_by_type, created_by_id) values ($1, 'evidence', $2, 'user', $3)",
            [order.id, JSON.stringify(evidencePhotoKeys), userId]
          );
        }
        await client.query(
          `insert into after_sales_history (after_sales_id, from_status, to_status, action, actor_type, actor_id, actor_role, reason)
           values ($1, '', 'purchase_review_pending', 'open_return', $2, $3, 'user', $4)`,
          [order.id, actor?.type || "user", actor?.id || userId, reason || ""]
        );
        await client.query("commit");
        return normalizeOrder(order);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findById(id) {
      const r = await pool().query("select * from after_sales_orders where id = $1", [id]);
      return normalizeOrder(r.rows[0]);
    },
    async findActiveByItem(itemOrderId) {
      const r = await pool().query(
        "select * from after_sales_orders where item_order_id = $1 and status not in ('completed','rejected','closed') order by created_at desc limit 1",
        [itemOrderId]
      );
      return normalizeOrder(r.rows[0]);
    },
    async listByUser(userId) {
      const r = await pool().query("select * from after_sales_orders where user_id = $1 order by created_at desc", [userId]);
      return r.rows.map(normalizeOrder);
    },
    async listByStatus({ status = null, role = null, limit = 50 } = {}) {
      const r = await pool().query(
        `select * from after_sales_orders where ($1::text is null or status = $1) and ($2::text is null or current_owner_role = $2)
         order by created_at desc limit $3`,
        [status, role, Math.min(limit, 100)]
      );
      return r.rows.map(normalizeOrder);
    },

    // ---- the generic transition primitive (version-guarded + history append) ----
    async transition({ afterSalesId, toStatus, action, actor, reason = "", note = "", patch = {}, expectedVersion, metadata = {} }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const order = (await client.query("select * from after_sales_orders where id = $1 for update", [afterSalesId])).rows[0];
        if (!order) { await client.query("rollback"); return { notFound: true }; }
        if (expectedVersion != null && order.version !== expectedVersion) { await client.query("rollback"); return { versionConflict: true, current: normalizeOrder(order) }; }
        const from = order.status;
        const ownerRole = AFTER_SALES_ROLE[toStatus] || order.current_owner_role;
        const sets = ["status = $2", "current_owner_role = $3", "version = version + 1"];
        const values = [afterSalesId, toStatus, ownerRole];
        let idx = 4;
        for (const [col, val] of Object.entries(patch)) {
          sets.push(`${col} = $${idx}`);
          values.push(val);
          idx += 1;
        }
        const updated = (await client.query(
          `update after_sales_orders set ${sets.join(", ")} where id = $1 returning *`, values
        )).rows[0];
        await client.query(
          `insert into after_sales_history (after_sales_id, from_status, to_status, action, actor_type, actor_id, actor_role, reason, note, metadata)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [afterSalesId, from, toStatus, action, actor?.type || "system", actor?.id || null, actor?.role || "", reason, note, JSON.stringify(metadata)]
        );
        await client.query("commit");
        return { order: normalizeOrder(updated), from };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async addAttachment({ afterSalesId, kind, photoKeys, note, createdByType, createdById }) {
      const r = await pool().query(
        `insert into after_sales_attachments (after_sales_id, kind, photo_keys, note, created_by_type, created_by_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [afterSalesId, kind, JSON.stringify(photoKeys || []), note || "", createdByType || "user", createdById || null]
      );
      return normalizeAttachment(r.rows[0]);
    },
    async listAttachments(afterSalesId, { kind = null } = {}) {
      const r = await pool().query(
        "select * from after_sales_attachments where after_sales_id = $1 and ($2::text is null or kind = $2) order by created_at asc",
        [afterSalesId, kind]
      );
      return r.rows.map(normalizeAttachment);
    },
    async listHistory(afterSalesId) {
      const r = await pool().query("select * from after_sales_history where after_sales_id = $1 order by created_at asc, id asc", [afterSalesId]);
      return r.rows.map(normalizeHistory);
    },

    // Release the reserved unit back to stock (rejection / closure without return).
    async releaseUnit(inventoryUnitId) {
      await pool().query("update inventory_units set status = 'in_stock' where id = $1 and status = 'return_reserved'", [inventoryUnitId]);
    },

    // Mark the unit fully returned (return packing complete).
    async markUnitReturning(inventoryUnitId) {
      await pool().query("update inventory_units set status = 'returning' where id = $1", [inventoryUnitId]);
    },
    async markUnitReturned(inventoryUnitId) {
      await pool().query("update inventory_units set status = 'returned' where id = $1", [inventoryUnitId]);
    },

    async findInventoryByItem(itemOrderId) {
      const r = await pool().query("select * from inventory_units where item_order_id = $1", [itemOrderId]);
      return normalizeInventory(r.rows[0]);
    },

    // ---- V2-08-06 return-fee bill ----
    async createReturnFeeBill({ billNo, afterSalesId, userId, subtotalMinor, totalMinor, breakdown }) {
      try {
        const r = await pool().query(
          `insert into after_sales_bills (bill_no, after_sales_id, user_id, kind, status, subtotal_cny_minor, total_cny_minor, breakdown)
           values ($1, $2, $3, 'return_fee', 'payable', $4, $5, $6) returning *`,
          [billNo, afterSalesId, userId, subtotalMinor, totalMinor, JSON.stringify(breakdown || {})]
        );
        return normalizeBill(r.rows[0]);
      } catch (error) {
        if (error.code === "23505") { const e = new Error("dup"); e.code = "BILL_EXISTS"; throw e; }
        throw error;
      }
    },
    async findActiveBill(afterSalesId, kind = "return_fee") {
      const r = await pool().query(
        "select * from after_sales_bills where after_sales_id = $1 and kind = $2 and status <> 'cancelled' order by created_at desc limit 1",
        [afterSalesId, kind]
      );
      return normalizeBill(r.rows[0]);
    },
    async listBills(afterSalesId) {
      const r = await pool().query("select * from after_sales_bills where after_sales_id = $1 order by created_at asc", [afterSalesId]);
      return r.rows.map(normalizeBill);
    },
    async markBillPaid({ billId, ledgerTxId, idempotencyKey }) {
      const r = await pool().query(
        "update after_sales_bills set status = 'paid', ledger_tx_id = $2, idempotency_key = $3, paid_at = now() where id = $1 and status = 'payable' returning *",
        [billId, ledgerTxId || null, idempotencyKey || null]
      );
      return normalizeBill(r.rows[0]);
    },

    // ---- V2-08-08 return inspection ----
    async recordInspection({ afterSalesId, quantityMatched, specMatched, photoKeys, weightGrams, lengthMm, widthMm, heightMm, note, adminId }) {
      const r = await pool().query(
        `insert into after_sales_return_inspections (after_sales_id, quantity_matched, spec_matched, photo_keys, weight_grams, length_mm, width_mm, height_mm, note, created_by_admin_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (after_sales_id) do update set quantity_matched = excluded.quantity_matched, spec_matched = excluded.spec_matched,
           photo_keys = excluded.photo_keys, weight_grams = excluded.weight_grams, length_mm = excluded.length_mm,
           width_mm = excluded.width_mm, height_mm = excluded.height_mm, note = excluded.note returning *`,
        [afterSalesId, quantityMatched, specMatched, JSON.stringify(photoKeys || []), weightGrams || null, lengthMm || null, widthMm || null, heightMm || null, note || "", adminId || null]
      );
      return normalizeInspection(r.rows[0]);
    },
    async findInspection(afterSalesId) {
      const r = await pool().query("select * from after_sales_return_inspections where after_sales_id = $1", [afterSalesId]);
      return normalizeInspection(r.rows[0]);
    },

    // ---- V2-08-09 ship back to merchant (dedup tracking, frozen address) ----
    async createShipment({ afterSalesId, carrier, trackingNo, merchantAddressSnapshot, adminId }) {
      try {
        const r = await pool().query(
          `insert into after_sales_shipments (after_sales_id, carrier, tracking_no, merchant_address_snapshot, status, created_by_admin_id)
           values ($1, $2, $3, $4, 'shipped', $5) returning *`,
          [afterSalesId, carrier || "", trackingNo || "", JSON.stringify(merchantAddressSnapshot || {}), adminId || null]
        );
        return normalizeShipment(r.rows[0]);
      } catch (error) {
        if (error.code === "23505") {
          const e = new Error("dup");
          e.code = error.constraint && error.constraint.includes("tracking") ? "TRACKING_DUPLICATE" : "SHIPMENT_EXISTS";
          throw e;
        }
        throw error;
      }
    },
    async findShipment(afterSalesId) {
      const r = await pool().query("select * from after_sales_shipments where after_sales_id = $1", [afterSalesId]);
      return normalizeShipment(r.rows[0]);
    },
    async appendShipmentEvent({ afterSalesId, event, status = null }) {
      const r = await pool().query(
        `update after_sales_shipments set events = events || $2::jsonb, status = coalesce($3, status)
         where after_sales_id = $1 returning *`,
        [afterSalesId, JSON.stringify([event]), status]
      );
      return normalizeShipment(r.rows[0]);
    },

    // ---- V2-08-07 warehouse return picking scan (atomic status + unit) ----
    async scanReturnPick({ afterSalesId, stockNo, expectedStatus, toStatus, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const order = (await client.query("select * from after_sales_orders where id = $1 for update", [afterSalesId])).rows[0];
        if (!order) { await client.query("rollback"); return { notFound: true }; }
        if (order.status !== expectedStatus) { await client.query("rollback"); return { conflict: true, status: order.status }; }
        const unit = (await client.query("select * from inventory_units where id = $1 for update", [order.inventory_unit_id])).rows[0];
        if (!unit || unit.stock_no !== stockNo) { await client.query("rollback"); return { wrongItem: true }; }
        await client.query("update inventory_units set status = 'returning' where id = $1", [unit.id]);
        const updated = (await client.query(
          "update after_sales_orders set status = $2, current_owner_role = 'warehouse', version = version + 1 where id = $1 returning *",
          [afterSalesId, toStatus]
        )).rows[0];
        await client.query(
          `insert into after_sales_history (after_sales_id, from_status, to_status, action, actor_type, actor_id, actor_role, metadata)
           values ($1, $2, $3, 'return_pick_scan', 'admin', $4, 'warehouse', $5)`,
          [afterSalesId, expectedStatus, toStatus, adminId || null, JSON.stringify({ stock_no: stockNo })]
        );
        await client.query("commit");
        return { order: normalizeOrder(updated), stockNo };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeInspection(row) {
  if (!row) return null;
  return {
    id: row.id, afterSalesId: row.after_sales_id, quantityMatched: row.quantity_matched, specMatched: row.spec_matched,
    photoKeys: row.photo_keys || [], weightGrams: row.weight_grams, lengthMm: row.length_mm, widthMm: row.width_mm,
    heightMm: row.height_mm, note: row.note, createdAt: row.created_at
  };
}

export function normalizeShipment(row) {
  if (!row) return null;
  return {
    id: row.id, afterSalesId: row.after_sales_id, carrier: row.carrier, trackingNo: row.tracking_no,
    merchantAddressSnapshot: row.merchant_address_snapshot || {}, status: row.status, events: row.events || [], createdAt: row.created_at
  };
}

export function normalizeBill(row) {
  if (!row) return null;
  return {
    id: row.id, billNo: row.bill_no, afterSalesId: row.after_sales_id, userId: row.user_id, kind: row.kind, status: row.status,
    subtotalCnyMinor: Number(row.subtotal_cny_minor), totalCnyMinor: Number(row.total_cny_minor), breakdown: row.breakdown || {},
    ledgerTxId: row.ledger_tx_id, paidAt: row.paid_at, createdAt: row.created_at
  };
}

function normalizeInventory(row) {
  if (!row) return null;
  return {
    id: row.id, stockNo: row.stock_no, itemOrderId: row.item_order_id, userId: row.user_id,
    status: row.status, officialInboundAt: row.official_inbound_at, returnDeadlineAt: row.return_deadline_at
  };
}

export function normalizeOrder(row) {
  if (!row) return null;
  return {
    id: row.id, asNo: row.as_no, itemOrderId: row.item_order_id, inventoryUnitId: row.inventory_unit_id, userId: row.user_id,
    status: row.status, reason: row.reason, description: row.description, quantity: row.quantity,
    responsibleParty: row.responsible_party, freightParty: row.freight_party, rejectReason: row.reject_reason,
    merchantRefundCnyMinor: Number(row.merchant_refund_cny_minor), merchantDeductionCnyMinor: Number(row.merchant_deduction_cny_minor),
    platformRefundCnyMinor: Number(row.platform_refund_cny_minor), returnFeeBillId: row.return_fee_bill_id,
    refundLedgerTxId: row.refund_ledger_tx_id, currentOwnerRole: row.current_owner_role, deadlineAt: row.deadline_at,
    closedAt: row.closed_at, completedAt: row.completed_at, version: row.version, createdAt: row.created_at
  };
}

export function normalizeHistory(row) {
  if (!row) return null;
  return {
    id: row.id, afterSalesId: row.after_sales_id, fromStatus: row.from_status, toStatus: row.to_status,
    action: row.action, actorType: row.actor_type, actorId: row.actor_id, actorRole: row.actor_role,
    reason: row.reason, note: row.note, metadata: row.metadata || {}, createdAt: row.created_at
  };
}

export function normalizeAttachment(row) {
  if (!row) return null;
  return {
    id: row.id, afterSalesId: row.after_sales_id, kind: row.kind, photoKeys: row.photo_keys || [],
    note: row.note, createdByType: row.created_by_type, createdById: row.created_by_id, createdAt: row.created_at
  };
}
