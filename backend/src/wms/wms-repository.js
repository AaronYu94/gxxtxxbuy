import { getDbPool } from "../db/pool.js";

// V2-06-01/02/03 — inbound package persistence. A courier number maps to exactly
// one package (unique index), so a re-scan finds the existing row.
export function createPgWmsRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async findInboundByTracking(trackingNo) {
      const result = await pool().query("select * from inbound_packages where domestic_tracking_no = $1", [trackingNo]);
      return normalizeInbound(result.rows[0]);
    },

    async findInboundById(id) {
      const result = await pool().query("select * from inbound_packages where id = $1", [id]);
      return normalizeInbound(result.rows[0]);
    },

    async createInbound(input) {
      const result = await pool().query(
        `insert into inbound_packages
           (domestic_tracking_no, carrier, item_order_id, user_id, status, first_scanned_by_admin_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [input.domesticTrackingNo, input.carrier || "", input.itemOrderId || null, input.userId || null,
         input.status || "unclaimed", input.firstScannedByAdminId || null]
      );
      return normalizeInbound(result.rows[0]);
    },

    async linkInbound(id, input) {
      const result = await pool().query(
        `update inbound_packages set item_order_id = $2, user_id = $3, status = 'matched',
           linked_by_admin_id = $4, link_evidence = $5
         where id = $1 and status = 'unclaimed' returning *`,
        [id, input.itemOrderId, input.userId, input.linkedByAdminId || null, JSON.stringify(input.linkEvidence || [])]
      );
      return normalizeInbound(result.rows[0]);
    },

    // V2-06-04 measurement with optimistic version. Photos required to complete.
    async submitMeasurement(id, input) {
      const result = await pool().query(
        `update inbound_packages set
           weight_grams = $3, length_mm = $4, width_mm = $5, height_mm = $6,
           photo_keys = $7, measured_at = now(), measurement_version = measurement_version + 1,
           status = 'measured'
         where id = $1 and measurement_version = $2 returning *`,
        [id, input.expectedVersion, input.weightGrams, input.lengthMm, input.widthMm, input.heightMm,
         JSON.stringify(input.photoKeys || [])]
      );
      return normalizeInbound(result.rows[0]);
    },

    async listUnclaimed(limit = 50) {
      const result = await pool().query(
        "select * from inbound_packages where status = 'unclaimed' order by created_at desc limit $1", [limit]
      );
      return result.rows.map(normalizeInbound);
    },

    async listInboundByUser(userId, limit = 50) {
      const result = await pool().query(
        "select * from inbound_packages where user_id = $1 order by created_at desc limit $2", [userId, limit]
      );
      return result.rows.map(normalizeInbound);
    },

    // ---- V2-06-05/06/07 QC ----
    async createQcTask(input) {
      const result = await pool().query(
        `insert into qc_tasks (item_order_id, inbound_package_id, user_id, type, unpack_required, wait_hours)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [input.itemOrderId, input.inboundPackageId || null, input.userId, input.type || "standard",
         Boolean(input.unpackRequired), input.waitHours || 0]
      );
      return normalizeQcTask(result.rows[0]);
    },

    async findQcTask(id) {
      const result = await pool().query("select * from qc_tasks where id = $1", [id]);
      return normalizeQcTask(result.rows[0]);
    },

    async findStandardQcTaskByItem(itemOrderId) {
      const result = await pool().query("select * from qc_tasks where item_order_id = $1 and type = 'standard'", [itemOrderId]);
      return normalizeQcTask(result.rows[0]);
    },

    async listQcTasks({ status = null, assigneeAdminId = null, limit = 50 } = {}) {
      const result = await pool().query(
        `select * from qc_tasks where ($1::text is null or status = $1) and ($2::uuid is null or assignee_admin_id = $2)
         order by created_at desc limit $3`,
        [status, assigneeAdminId, limit]
      );
      return result.rows.map(normalizeQcTask);
    },

    // Atomic claim — a single conditional UPDATE, so only one concurrent claim wins.
    async claimQcTask(id, adminUserId) {
      const result = await pool().query(
        "update qc_tasks set status = 'claimed', assignee_admin_id = $2, claimed_at = now() where id = $1 and status = 'pending' returning *",
        [id, adminUserId]
      );
      return normalizeQcTask(result.rows[0]);
    },

    async startQcTask(id, adminUserId) {
      const result = await pool().query(
        "update qc_tasks set status = 'in_progress' where id = $1 and status = 'claimed' and assignee_admin_id = $2 returning *",
        [id, adminUserId]
      );
      return normalizeQcTask(result.rows[0]);
    },

    async releaseQcTask(id) {
      const result = await pool().query(
        "update qc_tasks set status = 'pending', assignee_admin_id = null, claimed_at = null where id = $1 and status in ('claimed', 'in_progress') returning *",
        [id]
      );
      return normalizeQcTask(result.rows[0]);
    },

    async markQcTask(id, patch) {
      const result = await pool().query(
        `update qc_tasks set status = coalesce($2, status), exception_note = coalesce($3, exception_note),
           completed_at = coalesce($4, completed_at) where id = $1 returning *`,
        [id, patch.status ?? null, patch.exceptionNote ?? null, patch.completedAt ?? null]
      );
      return normalizeQcTask(result.rows[0]);
    },

    // Re-shoots keep history: each upload is a new version for its slot.
    async addQcPhoto({ qcTaskId, slot, storageKey }) {
      const result = await pool().query(
        `insert into qc_photos (qc_task_id, slot, storage_key, version)
         values ($1, $2, $3, coalesce((select max(version) from qc_photos where qc_task_id = $1 and slot = $2), 0) + 1)
         returning *`,
        [qcTaskId, slot, storageKey]
      );
      return normalizeQcPhoto(result.rows[0]);
    },

    async currentQcSlots(qcTaskId) {
      const result = await pool().query("select distinct slot from qc_photos where qc_task_id = $1", [qcTaskId]);
      return result.rows.map((r) => r.slot);
    },

    async listQcPhotos(qcTaskId) {
      const result = await pool().query("select * from qc_photos where qc_task_id = $1 order by slot asc, version desc", [qcTaskId]);
      return result.rows.map(normalizeQcPhoto);
    },

    // ---- V2-06-08/09 paid add-ons ----
    async findQcPurchaseByIdem(userId, key) {
      if (!key) return null;
      const result = await pool().query("select * from qc_purchases where user_id = $1 and idempotency_key = $2", [userId, key]);
      return normalizeQcPurchase(result.rows[0]);
    },

    async createQcPurchase(input) {
      const result = await pool().query(
        `insert into qc_purchases (item_order_id, qc_task_id, user_id, kind, quantity, amount_cny_minor, ledger_tx_id, idempotency_key, detail)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [input.itemOrderId, input.qcTaskId || null, input.userId, input.kind, input.quantity, input.amountCnyMinor,
         input.ledgerTxId || null, input.idempotencyKey || null, JSON.stringify(input.detail || {})]
      );
      return normalizeQcPurchase(result.rows[0]);
    },

    async listQcPurchases(itemOrderId) {
      const result = await pool().query("select * from qc_purchases where item_order_id = $1 order by created_at desc", [itemOrderId]);
      return result.rows.map(normalizeQcPurchase);
    },

    // ---- V2-06-10 QC exceptions ----
    async createQcException(input) {
      const result = await pool().query(
        `insert into qc_exceptions (qc_task_id, type, note, photo_keys, created_by_admin_id)
         values ($1, $2, $3, $4, $5) returning *`,
        [input.qcTaskId, input.type, input.note || "", JSON.stringify(input.photoKeys || []), input.createdByAdminId || null]
      );
      return normalizeQcException(result.rows[0]);
    },

    async listQcExceptions(qcTaskId) {
      const result = await pool().query("select * from qc_exceptions where qc_task_id = $1 order by created_at desc", [qcTaskId]);
      return result.rows.map(normalizeQcException);
    },

    async hasOpenException(qcTaskId) {
      const result = await pool().query("select 1 from qc_exceptions where qc_task_id = $1 and status = 'open' limit 1", [qcTaskId]);
      return result.rows.length > 0;
    },

    async resolveQcExceptions(qcTaskId, adminUserId) {
      await pool().query(
        "update qc_exceptions set status = 'resolved', resolved_by_admin_id = $2, resolved_at = now() where qc_task_id = $1 and status = 'open'",
        [qcTaskId, adminUserId || null]
      );
    },

    // ---- V2-06-11 QC completion + official warehousing ----
    async findInventoryByItem(itemOrderId) {
      const result = await pool().query("select * from inventory_units where item_order_id = $1", [itemOrderId]);
      return normalizeInventory(result.rows[0]);
    },

    async findInventoryById(id) {
      const result = await pool().query("select * from inventory_units where id = $1", [id]);
      return normalizeInventory(result.rows[0]);
    },

    async listInventoryByUser(userId, limit = 50) {
      const result = await pool().query("select * from inventory_units where user_id = $1 order by created_at desc limit $2", [userId, limit]);
      return result.rows.map(normalizeInventory);
    },

    // Atomic completion: mark the QC task completed AND create the inventory unit
    // with the official inbound time (= 5-day return start). Idempotent: a task
    // already completed returns the existing unit and never re-stamps the time.
    async completeQcAndStock({ qcTaskId, itemOrderId, userId, stockNo }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const task = (await client.query("select * from qc_tasks where id = $1 for update", [qcTaskId])).rows[0];
        if (!task) { await client.query("rollback"); return { task: null }; }
        if (task.status === "completed") {
          const inv = (await client.query("select * from inventory_units where item_order_id = $1", [itemOrderId])).rows[0];
          await client.query("commit");
          return { task: normalizeQcTask(task), inventory: normalizeInventory(inv), replay: true };
        }
        if (task.status !== "in_progress") {
          await client.query("rollback");
          const error = new Error("QC task is not in progress."); error.code = "QC_STATE"; throw error;
        }
        const updatedTask = (await client.query(
          "update qc_tasks set status = 'completed', completed_at = now() where id = $1 returning *", [qcTaskId]
        )).rows[0];
        const inv = (await client.query(
          `insert into inventory_units (stock_no, item_order_id, qc_task_id, user_id, status, official_inbound_at, return_deadline_at)
           values ($1, $2, $3, $4, 'in_stock', now(), now() + interval '5 days') returning *`,
          [stockNo, itemOrderId, qcTaskId, userId]
        )).rows[0];
        await client.query("commit");
        return { task: normalizeQcTask(updatedTask), inventory: normalizeInventory(inv), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-06-12 locations ----
    async createLocation(input) {
      const result = await pool().query(
        `insert into warehouse_locations (code, area, shelf, level, position) values ($1, $2, $3, $4, $5) returning *`,
        [input.code, input.area || "", input.shelf || "", input.level || "", input.position || ""]
      );
      return normalizeLocation(result.rows[0]);
    },

    async findLocationByCode(code) {
      const result = await pool().query("select * from warehouse_locations where code = $1", [code]);
      return normalizeLocation(result.rows[0]);
    },

    async findLocationById(id) {
      const result = await pool().query("select * from warehouse_locations where id = $1", [id]);
      return normalizeLocation(result.rows[0]);
    },

    async listLocations(limit = 200) {
      const result = await pool().query("select * from warehouse_locations order by code asc limit $1", [limit]);
      return result.rows.map(normalizeLocation);
    },

    async locationOccupancy(locationId) {
      const result = await pool().query(
        "select count(*)::int c from inventory_units where location_id = $1 and status not in ('outbound', 'returned', 'destroyed')",
        [locationId]
      );
      return result.rows[0].c;
    },

    async disableLocation(id) {
      const result = await pool().query("update warehouse_locations set enabled = false where id = $1 returning *", [id]);
      return normalizeLocation(result.rows[0]);
    },

    async findInventoryByStockNo(stockNo) {
      const result = await pool().query("select * from inventory_units where stock_no = $1", [stockNo]);
      return normalizeInventory(result.rows[0]);
    },

    // ---- V2-06-13 double-scan assignment ----
    async assignLocation({ stockNo, locationId, adminUserId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const inv = (await client.query("select * from inventory_units where stock_no = $1 for update", [stockNo])).rows[0];
        if (!inv) { await client.query("rollback"); return { inventory: null }; }
        if (inv.location_id === locationId) {
          await client.query("commit");
          return { inventory: normalizeInventory(inv), replay: true };
        }
        if (inv.location_id) {
          await client.query("rollback");
          const error = new Error("Item is already assigned to a location; move it instead."); error.code = "LOCATION_OCCUPIED"; throw error;
        }
        const updated = (await client.query("update inventory_units set location_id = $2 where id = $1 returning *", [inv.id, locationId])).rows[0];
        await client.query(
          "insert into location_movements (inventory_unit_id, from_location_id, to_location_id, reason, moved_by_admin_id) values ($1, null, $2, 'assign', $3)",
          [inv.id, locationId, adminUserId || null]
        );
        await client.query("commit");
        return { inventory: normalizeInventory(updated), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-06-14 double-scan movement ----
    async moveLocation({ stockNo, fromLocationId, toLocationId, reason, adminUserId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const inv = (await client.query("select * from inventory_units where stock_no = $1 for update", [stockNo])).rows[0];
        if (!inv) { await client.query("rollback"); return { inventory: null }; }
        if (inv.location_id !== fromLocationId) {
          await client.query("rollback");
          const error = new Error("Origin location does not match the item's current location."); error.code = "LOCATION_MISMATCH"; throw error;
        }
        const updated = (await client.query("update inventory_units set location_id = $2 where id = $1 returning *", [inv.id, toLocationId])).rows[0];
        await client.query(
          "insert into location_movements (inventory_unit_id, from_location_id, to_location_id, reason, moved_by_admin_id) values ($1, $2, $3, $4, $5)",
          [inv.id, fromLocationId, toLocationId, reason || "", adminUserId || null]
        );
        await client.query("commit");
        return { inventory: normalizeInventory(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listMovements(inventoryUnitId) {
      const result = await pool().query("select * from location_movements where inventory_unit_id = $1 order by created_at asc", [inventoryUnitId]);
      return result.rows.map(normalizeMovement);
    },

    // ---- V2-06-15 shipping restrictions ----
    async setShippingRestrictions({ inventoryUnitId, restrictions, adminUserId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const updated = (await client.query(
          "update inventory_units set shipping_restrictions = $2 where id = $1 returning *",
          [inventoryUnitId, JSON.stringify(restrictions)]
        )).rows[0];
        await client.query(
          "insert into shipping_restriction_changes (inventory_unit_id, restrictions, changed_by_admin_id) values ($1, $2, $3)",
          [inventoryUnitId, JSON.stringify(restrictions), adminUserId || null]
        );
        await client.query("commit");
        return normalizeInventory(updated);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-06-16 storage extensions ----
    async findStorageExtensionByIdem(userId, key) {
      if (!key) return null;
      const result = await pool().query("select * from storage_extensions where user_id = $1 and idempotency_key = $2", [userId, key]);
      return result.rows[0] || null;
    },

    async addStorageExtension({ inventoryUnitId, userId, months, amountMinor, ledgerTxId, idempotencyKey }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const inv = (await client.query("select * from inventory_units where id = $1 for update", [inventoryUnitId])).rows[0];
        if (!inv) { await client.query("rollback"); return { inventory: null }; }
        if (inv.paid_extension_months + months > 2) {
          await client.query("rollback");
          const error = new Error("Storage can be extended at most two months."); error.code = "STORAGE_MAX_EXTENSION"; throw error;
        }
        const updated = (await client.query(
          "update inventory_units set paid_extension_months = paid_extension_months + $2 where id = $1 returning *",
          [inventoryUnitId, months]
        )).rows[0];
        await client.query(
          "insert into storage_extensions (inventory_unit_id, user_id, months, amount_cny_minor, ledger_tx_id, idempotency_key) values ($1, $2, $3, $4, $5, $6)",
          [inventoryUnitId, userId, months, amountMinor, ledgerTxId || null, idempotencyKey || null]
        );
        await client.query("commit");
        return { inventory: normalizeInventory(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-06-17 reminders + destroy state ----
    async listActiveInventory(limit = 500) {
      const result = await pool().query(
        "select * from inventory_units where status in ('in_stock', 'reserved', 'return_reserved') order by official_inbound_at asc limit $1", [limit]
      );
      return result.rows.map(normalizeInventory);
    },

    async markReminderSent(inventoryUnitId, milestone) {
      const result = await pool().query(
        "insert into storage_reminders (inventory_unit_id, milestone) values ($1, $2) on conflict (inventory_unit_id, milestone) do nothing returning *",
        [inventoryUnitId, milestone]
      );
      return result.rows.length > 0; // true = newly sent
    },

    async markForDestroy(inventoryUnitId) {
      const result = await pool().query(
        "update inventory_units set status = 'destroy_pending' where id = $1 and status = 'in_stock' returning *", [inventoryUnitId]
      );
      return normalizeInventory(result.rows[0]);
    },

    // ---- V2-06-18 destroy execution (irreversible) ----
    async executeDestroy({ inventoryUnitId, quantity, photoKeys, adminUserId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const inv = (await client.query("select * from inventory_units where id = $1 for update", [inventoryUnitId])).rows[0];
        if (!inv) { await client.query("rollback"); return { inventory: null }; }
        if (inv.status === "destroyed") {
          await client.query("commit");
          return { inventory: normalizeInventory(inv), replay: true };
        }
        if (inv.status !== "destroy_pending") {
          await client.query("rollback");
          const error = new Error("Item is not pending destruction."); error.code = "DESTROY_STATE"; throw error;
        }
        const updated = (await client.query("update inventory_units set status = 'destroyed' where id = $1 returning *", [inventoryUnitId])).rows[0];
        await client.query(
          "insert into destroy_records (inventory_unit_id, quantity, photo_keys, executed_by_admin_id) values ($1, $2, $3, $4)",
          [inventoryUnitId, quantity, JSON.stringify(photoKeys || []), adminUserId || null]
        );
        await client.query("commit");
        return { inventory: normalizeInventory(updated), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeLocation(row) {
  if (!row) return null;
  return {
    id: row.id, code: row.code, area: row.area, shelf: row.shelf, level: row.level,
    position: row.position, enabled: row.enabled, createdAt: row.created_at
  };
}

export function normalizeMovement(row) {
  if (!row) return null;
  return {
    id: row.id, inventoryUnitId: row.inventory_unit_id, fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id, reason: row.reason, movedByAdminId: row.moved_by_admin_id, createdAt: row.created_at
  };
}

export function normalizeInventory(row) {
  if (!row) return null;
  return {
    id: row.id,
    stockNo: row.stock_no,
    itemOrderId: row.item_order_id,
    qcTaskId: row.qc_task_id,
    userId: row.user_id,
    status: row.status,
    officialInboundAt: row.official_inbound_at,
    returnDeadlineAt: row.return_deadline_at,
    locationId: row.location_id,
    shippingRestrictions: row.shipping_restrictions || [],
    paidExtensionMonths: row.paid_extension_months ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeQcPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemOrderId: row.item_order_id,
    qcTaskId: row.qc_task_id,
    userId: row.user_id,
    kind: row.kind,
    quantity: row.quantity,
    amountCnyMinor: Number(row.amount_cny_minor),
    status: row.status,
    ledgerTxId: row.ledger_tx_id,
    idempotencyKey: row.idempotency_key,
    detail: row.detail || {},
    createdAt: row.created_at
  };
}

export function normalizeQcException(row) {
  if (!row) return null;
  return {
    id: row.id,
    qcTaskId: row.qc_task_id,
    type: row.type,
    note: row.note,
    photoKeys: row.photo_keys || [],
    status: row.status,
    createdByAdminId: row.created_by_admin_id,
    resolvedByAdminId: row.resolved_by_admin_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

export function normalizeQcTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemOrderId: row.item_order_id,
    inboundPackageId: row.inbound_package_id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    assigneeAdminId: row.assignee_admin_id,
    claimedAt: row.claimed_at,
    unpackRequired: row.unpack_required,
    waitHours: row.wait_hours,
    exceptionNote: row.exception_note,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeQcPhoto(row) {
  if (!row) return null;
  return {
    id: row.id,
    qcTaskId: row.qc_task_id,
    slot: row.slot,
    storageKey: row.storage_key,
    version: row.version,
    createdAt: row.created_at
  };
}

export function normalizeInbound(row) {
  if (!row) return null;
  return {
    id: row.id,
    domesticTrackingNo: row.domestic_tracking_no,
    carrier: row.carrier,
    itemOrderId: row.item_order_id,
    userId: row.user_id,
    status: row.status,
    firstScannedByAdminId: row.first_scanned_by_admin_id,
    firstScannedAt: row.first_scanned_at,
    weightGrams: row.weight_grams,
    lengthMm: row.length_mm,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    photoKeys: row.photo_keys || [],
    measuredAt: row.measured_at,
    measurementVersion: row.measurement_version,
    linkedByAdminId: row.linked_by_admin_id,
    linkEvidence: row.link_evidence || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
