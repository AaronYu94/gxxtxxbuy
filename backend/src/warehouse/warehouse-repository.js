import { getDbPool } from "../db/pool.js";

export function createPgWarehouseRepository(env) {
  return {
    async findPurchaseOrderForReceive(targetId) {
      const result = await getDbPool(env).query(
        `select
           purchase_orders.id as purchase_order_id,
           purchase_orders.user_id,
           purchase_orders.haul_item_id,
           purchase_orders.status as order_status,
           haul_items.status as haul_item_status
         from purchase_orders
         join haul_items on haul_items.id = purchase_orders.haul_item_id
         where purchase_orders.id = $1 or purchase_orders.haul_item_id = $1
         limit 1`,
        [targetId]
      );
      return normalizeReceivableOrder(result.rows[0]);
    },

    async findWarehouseItemByOrder(orderId) {
      const result = await getDbPool(env).query(
        `select * from warehouse_items where purchase_order_id = $1 limit 1`,
        [orderId]
      );
      return normalizeWarehouseItem(result.rows[0]);
    },

    async findWarehouseItemById(id) {
      const result = await getDbPool(env).query("select * from warehouse_items where id = $1 limit 1", [id]);
      return normalizeWarehouseItem(result.rows[0]);
    },

    async findWarehouseItemForUser(userId, id) {
      const result = await getDbPool(env).query(
        `select * from warehouse_items where user_id = $1 and id = $2 limit 1`,
        [userId, id]
      );
      return normalizeWarehouseItem(result.rows[0]);
    },

    async createWarehouseItem(input) {
      const result = await getDbPool(env).query(
        `insert into warehouse_items (
          user_id,
          purchase_order_id,
          haul_item_id,
          status,
          storage_location,
          received_at
        ) values ($1, $2, $3, 'received', $4, coalesce($5, now()))
        on conflict (purchase_order_id) do update
        set storage_location = coalesce(nullif(excluded.storage_location, ''), warehouse_items.storage_location)
        returning *`,
        [
          input.userId,
          input.purchaseOrderId,
          input.haulItemId,
          input.storageLocation || "",
          input.receivedAt || null
        ]
      );
      await getDbPool(env).query(
        `update haul_items set status = 'arrived'
         where user_id = $1 and id = $2 and status in ('purchasing', 'seller_shipped', 'waiting_purchase')`,
        [input.userId, input.haulItemId]
      );
      return normalizeWarehouseItem(result.rows[0]);
    },

    async updateWeight(warehouseItemId, weightGrams) {
      const result = await getDbPool(env).query(
        `update warehouse_items
         set weight_grams = $2
         where id = $1
         returning *`,
        [warehouseItemId, weightGrams]
      );
      return normalizeWarehouseItem(result.rows[0]);
    },

    async listPhotos(warehouseItemId) {
      const result = await getDbPool(env).query(
        `select * from qc_photos
         where warehouse_item_id = $1 and status = 'active'
         order by sort_order asc`,
        [warehouseItemId]
      );
      return result.rows.map(normalizeQcPhoto);
    },

    async addQcPhoto(input) {
      const result = await getDbPool(env).query(
        `insert into qc_photos (
          user_id,
          warehouse_item_id,
          storage_key,
          file_name,
          content_type,
          size_bytes,
          sort_order,
          created_by_admin_user_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *`,
        [
          input.userId,
          input.warehouseItemId,
          input.storageKey,
          input.fileName,
          input.contentType,
          input.sizeBytes,
          input.sortOrder,
          input.createdByAdminUserId
        ]
      );
      return normalizeQcPhoto(result.rows[0]);
    },

    async markQcReady(warehouseItemId) {
      const result = await getDbPool(env).query(
        `update warehouse_items
         set status = case when status = 'ready_to_ship' then status else 'qc_ready' end
         where id = $1
         returning *`,
        [warehouseItemId]
      );
      return normalizeWarehouseItem(result.rows[0]);
    },

    async listUserWarehouseItems(userId) {
      const result = await getDbPool(env).query(
        `select * from warehouse_items
         where user_id = $1
         order by received_at desc`,
        [userId]
      );
      return result.rows.map(normalizeWarehouseItem);
    },

    async approveQc(userId, warehouseItemId) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `update warehouse_items
           set status = 'ready_to_ship'
           where user_id = $1 and id = $2
           returning *`,
          [userId, warehouseItemId]
        );
        const item = normalizeWarehouseItem(result.rows[0]);
        if (item) {
          await client.query(
            `update haul_items set status = 'ready_to_ship'
             where user_id = $1 and id = $2`,
            [userId, item.haulItemId]
          );
        }
        await client.query("commit");
        return item;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async findOpenExtraPhotoRequest(userId, warehouseItemId) {
      const result = await getDbPool(env).query(
        `select * from extra_photo_requests
         where user_id = $1 and warehouse_item_id = $2 and status = 'open'
         limit 1`,
        [userId, warehouseItemId]
      );
      return normalizeExtraPhotoRequest(result.rows[0]);
    },

    async createExtraPhotoRequest(input) {
      const result = await getDbPool(env).query(
        `insert into extra_photo_requests (user_id, warehouse_item_id, reason)
         values ($1, $2, $3)
         on conflict (warehouse_item_id) where status = 'open'
         do update set reason = extra_photo_requests.reason
         returning *`,
        [input.userId, input.warehouseItemId, input.reason || ""]
      );
      await getDbPool(env).query(
        `update warehouse_items
         set status = 'extra_photo_requested'
         where id = $1 and user_id = $2 and status <> 'ready_to_ship'`,
        [input.warehouseItemId, input.userId]
      );
      return normalizeExtraPhotoRequest(result.rows[0]);
    }
  };
}

export function normalizeReceivableOrder(row) {
  if (!row) return null;
  return {
    purchaseOrderId: String(row.purchase_order_id ?? row.purchaseOrderId),
    userId: String(row.user_id ?? row.userId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    orderStatus: row.order_status ?? row.orderStatus,
    haulItemStatus: row.haul_item_status ?? row.haulItemStatus
  };
}

export function normalizeWarehouseItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    purchaseOrderId: String(row.purchase_order_id ?? row.purchaseOrderId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    status: row.status,
    storageLocation: row.storage_location ?? row.storageLocation ?? "",
    weightGrams: row.weight_grams ?? row.weightGrams ?? null,
    freeStorageDays: Number(row.free_storage_days ?? row.freeStorageDays ?? 90),
    receivedAt: toIso(row.received_at ?? row.receivedAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeQcPhoto(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    warehouseItemId: String(row.warehouse_item_id ?? row.warehouseItemId),
    storageKey: row.storage_key ?? row.storageKey,
    fileName: row.file_name ?? row.fileName,
    contentType: row.content_type ?? row.contentType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sortOrder: Number(row.sort_order ?? row.sortOrder),
    status: row.status,
    createdByAdminUserId: row.created_by_admin_user_id ?? row.createdByAdminUserId ?? null,
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizeExtraPhotoRequest(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    warehouseItemId: String(row.warehouse_item_id ?? row.warehouseItemId),
    status: row.status,
    reason: row.reason || "",
    createdAt: toIso(row.created_at ?? row.createdAt),
    fulfilledAt: toIso(row.fulfilled_at ?? row.fulfilledAt)
  };
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
