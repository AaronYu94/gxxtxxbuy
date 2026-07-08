import { centsToMoney } from "../core/core-input.js";
import { getDbPool } from "../db/pool.js";

const HAUL_STATUS_BY_ORDER_STATUS = Object.freeze({
  submitted: "purchasing",
  purchasing: "purchasing",
  seller_shipped: "seller_shipped",
  arrived: "arrived",
  qc_ready: "qc_ready",
  cancelled: "cancelled"
});

export function createPgAdminRepository(env) {
  return {
    async getOverviewCounts() {
      const pool = getDbPool(env);
      const [orders, warehouse, parcels, policies] = await Promise.all([
        pool.query(
          `select
             count(*)::int as total,
             (count(*) filter (where status = 'submitted'))::int as submitted,
             (count(*) filter (where status = 'purchasing'))::int as purchasing,
             (count(*) filter (where status = 'seller_shipped'))::int as seller_shipped,
             (count(*) filter (where status = 'arrived'))::int as arrived,
             (count(*) filter (where status = 'qc_ready'))::int as qc_ready,
             (count(*) filter (where status = 'exception'))::int as exceptions,
             (count(*) filter (where status = 'cancelled'))::int as cancelled
           from purchase_orders`
        ),
        pool.query(
          `select
             count(*)::int as total,
             (count(*) filter (where status = 'received'))::int as received,
             (count(*) filter (where status = 'qc_pending'))::int as qc_pending,
             (count(*) filter (where status = 'qc_ready'))::int as qc_ready,
             (count(*) filter (where status = 'extra_photo_requested'))::int as extra_photo_requested,
             (count(*) filter (where status = 'ready_to_ship'))::int as ready_to_ship
           from warehouse_items`
        ),
        pool.query(
          `select
             count(*)::int as total,
             (count(*) filter (where status = 'draft'))::int as draft,
             (count(*) filter (where status = 'shipping_due'))::int as shipping_due,
             (count(*) filter (where status = 'payment_pending'))::int as payment_pending,
             (count(*) filter (where status = 'paid'))::int as paid,
             (count(*) filter (where status = 'processing'))::int as processing,
             (count(*) filter (where status = 'dispatched'))::int as dispatched,
             (count(*) filter (where status = 'in_transit'))::int as in_transit,
             (count(*) filter (where status = 'delivered'))::int as delivered,
             (count(*) filter (where status = 'cancelled'))::int as cancelled
           from parcels`
        ),
        pool.query(
          `select
             count(*)::int as total,
             (count(*) filter (where status = 'draft'))::int as draft,
             (count(*) filter (where status = 'published'))::int as published,
             (count(*) filter (where status = 'archived'))::int as archived
           from policy_pages`
        )
      ]);

      return {
        orders: counts(orders.rows[0]),
        warehouse: counts(warehouse.rows[0]),
        parcels: counts(parcels.rows[0]),
        policies: counts(policies.rows[0])
      };
    },

    async listOrders({ status = "", limit = 25, offset = 0 } = {}) {
      const result = await getDbPool(env).query(
        `select
           purchase_orders.*,
           users.email as user_email,
           haul_items.title,
           haul_items.spec,
           haul_items.price_cents,
           haul_items.currency,
           haul_items.quantity,
           haul_items.status as haul_status,
           haul_items.source_platform,
           haul_items.source_domain,
           count(*) over()::int as total_count
         from purchase_orders
         join users on users.id = purchase_orders.user_id
         join haul_items on haul_items.id = purchase_orders.haul_item_id
         where ($1 = '' or purchase_orders.status = $1)
         order by purchase_orders.created_at desc
         limit $2 offset $3`,
        [status, limit, offset]
      );
      return paged(result.rows, normalizeAdminOrder);
    },

    async findOrderById(orderId) {
      const result = await getDbPool(env).query(
        `select
           purchase_orders.*,
           users.email as user_email,
           haul_items.title,
           haul_items.spec,
           haul_items.price_cents,
           haul_items.currency,
           haul_items.quantity,
           haul_items.status as haul_status,
           haul_items.source_platform,
           haul_items.source_domain
         from purchase_orders
         join users on users.id = purchase_orders.user_id
         join haul_items on haul_items.id = purchase_orders.haul_item_id
         where purchase_orders.id = $1
         limit 1`,
        [orderId]
      );
      return normalizeAdminOrder(result.rows[0]);
    },

    async updateOrderStatus(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const currentResult = await client.query("select * from purchase_orders where id = $1 for update", [input.orderId]);
        const current = currentResult.rows[0];
        if (!current) {
          await client.query("rollback");
          return null;
        }

        if (current.status === input.status) {
          await client.query("commit");
          return this.findOrderById(input.orderId);
        }

        await client.query(
          `update purchase_orders
           set status = $2,
               external_order_no = coalesce(nullif($3, ''), external_order_no),
               exception = case when $2 <> 'exception' then '' else exception end
           where id = $1`,
          [input.orderId, input.status, input.externalOrderNo || ""]
        );

        const haulStatus = HAUL_STATUS_BY_ORDER_STATUS[input.status];
        if (haulStatus) {
          await client.query(
            `update haul_items
             set status = $2
             where id = $1`,
            [current.haul_item_id, haulStatus]
          );
        }

        await client.query(
          `insert into order_status_history (
            order_id,
            user_id,
            from_status,
            to_status,
            changed_by_type,
            changed_by_admin_user_id,
            reason
          ) values ($1, $2, $3, $4, 'admin', $5, $6)`,
          [
            input.orderId,
            current.user_id,
            current.status,
            input.status,
            input.adminUserId,
            input.reason || "admin_status_update"
          ]
        );

        await client.query("commit");
        return this.findOrderById(input.orderId);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async updateOrderException(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const currentResult = await client.query("select * from purchase_orders where id = $1 for update", [input.orderId]);
        const current = currentResult.rows[0];
        if (!current) {
          await client.query("rollback");
          return null;
        }

        await client.query(
          `update purchase_orders
           set status = 'exception',
               exception = $2
           where id = $1`,
          [input.orderId, input.exception]
        );

        if (current.status !== "exception") {
          await client.query(
            `insert into order_status_history (
              order_id,
              user_id,
              from_status,
              to_status,
              changed_by_type,
              changed_by_admin_user_id,
              reason
            ) values ($1, $2, $3, 'exception', 'admin', $4, $5)`,
            [input.orderId, current.user_id, current.status, input.adminUserId, input.exception]
          );
        }

        await client.query("commit");
        return this.findOrderById(input.orderId);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listWarehouseItems({ status = "", limit = 25, offset = 0 } = {}) {
      const result = await getDbPool(env).query(
        `select
           warehouse_items.*,
           users.email as user_email,
           haul_items.title,
           haul_items.spec,
           haul_items.status as haul_status,
           purchase_orders.status as order_status,
           count(qc_photos.id)::int as photo_count,
           count(*) over()::int as total_count
         from warehouse_items
         join users on users.id = warehouse_items.user_id
         join haul_items on haul_items.id = warehouse_items.haul_item_id
         join purchase_orders on purchase_orders.id = warehouse_items.purchase_order_id
         left join qc_photos
           on qc_photos.warehouse_item_id = warehouse_items.id
          and qc_photos.status = 'active'
         where ($1 = '' or warehouse_items.status = $1)
         group by warehouse_items.id, users.email, haul_items.id, purchase_orders.id
         order by warehouse_items.received_at desc
         limit $2 offset $3`,
        [status, limit, offset]
      );
      return paged(result.rows, normalizeAdminWarehouseItem);
    },

    async listParcels({ status = "", limit = 25, offset = 0 } = {}) {
      const result = await getDbPool(env).query(
        `select
           parcels.*,
           users.email as user_email,
           shipping_lines.code as shipping_line_code,
           shipping_lines.name as shipping_line_name,
           count(parcel_items.id)::int as item_count,
           latest_payment.status as payment_status,
           latest_payment.amount_cents as payment_amount_cents,
           latest_payment.provider as payment_provider,
           count(*) over()::int as total_count
         from parcels
         join users on users.id = parcels.user_id
         left join shipping_lines on shipping_lines.id = parcels.shipping_line_id
         left join parcel_items
           on parcel_items.parcel_id = parcels.id
          and parcel_items.status = 'active'
         left join lateral (
           select status, amount_cents, provider
           from shipping_payments
           where shipping_payments.parcel_id = parcels.id
           order by shipping_payments.created_at desc
           limit 1
         ) latest_payment on true
         where ($1 = '' or parcels.status = $1)
         group by parcels.id, users.email, shipping_lines.id, latest_payment.status, latest_payment.amount_cents, latest_payment.provider
         order by parcels.created_at desc
         limit $2 offset $3`,
        [status, limit, offset]
      );
      return paged(result.rows, normalizeAdminParcel);
    },

    async listPolicies({ status = "", limit = 50, offset = 0 } = {}) {
      const result = await getDbPool(env).query(
        `select *, count(*) over()::int as total_count
         from policy_pages
         where ($1 = '' or status = $1)
         order by policy_type asc
         limit $2 offset $3`,
        [status, limit, offset]
      );
      return paged(result.rows, normalizeAdminPolicy);
    },

    async updatePolicy(input) {
      const result = await getDbPool(env).query(
        `update policy_pages
         set title = coalesce($2, title),
             body = coalesce($3, body),
             status = coalesce($4, status),
             version = version + 1,
             published_at = case
               when coalesce($4, status) = 'published' and published_at is null then now()
               else published_at
             end
         where id = $1
         returning *`,
        [
          input.policyId,
          input.title ?? null,
          input.body ?? null,
          input.status ?? null
        ]
      );
      return normalizeAdminPolicy(result.rows[0]);
    }
  };
}

export function normalizeAdminOrder(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    userEmail: row.user_email ?? row.userEmail ?? "",
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    title: row.title || "",
    spec: row.spec || "",
    priceCents: nullableNumber(row.price_cents ?? row.priceCents),
    price: centsToMoney(row.price_cents ?? row.priceCents),
    currency: row.currency || "USD",
    quantity: Number(row.quantity || 1),
    sourcePlatform: row.source_platform ?? row.sourcePlatform ?? "Other",
    sourceDomain: row.source_domain ?? row.sourceDomain ?? "",
    status: row.status,
    haulStatus: row.haul_status ?? row.haulStatus ?? "",
    exception: row.exception || "",
    externalOrderNo: row.external_order_no ?? row.externalOrderNo ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeAdminWarehouseItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    userEmail: row.user_email ?? row.userEmail ?? "",
    purchaseOrderId: String(row.purchase_order_id ?? row.purchaseOrderId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    title: row.title || "",
    spec: row.spec || "",
    status: row.status,
    haulStatus: row.haul_status ?? row.haulStatus ?? "",
    orderStatus: row.order_status ?? row.orderStatus ?? "",
    storageLocation: row.storage_location ?? row.storageLocation ?? "",
    weightGrams: nullableNumber(row.weight_grams ?? row.weightGrams),
    freeStorageDays: Number(row.free_storage_days ?? row.freeStorageDays ?? 90),
    photoCount: Number(row.photo_count ?? row.photoCount ?? 0),
    receivedAt: toIso(row.received_at ?? row.receivedAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeAdminParcel(row) {
  if (!row) return null;
  const finalFeeCents = nullableNumber(row.final_fee_cents ?? row.finalFeeCents);
  const paymentAmountCents = nullableNumber(row.payment_amount_cents ?? row.paymentAmountCents);
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    userEmail: row.user_email ?? row.userEmail ?? "",
    status: row.status,
    destinationCountry: row.destination_country ?? row.destinationCountry ?? "",
    recipientName: row.recipient_name ?? row.recipientName ?? "",
    shippingLineId: row.shipping_line_id ? String(row.shipping_line_id) : row.shippingLineId || null,
    shippingLineCode: row.shipping_line_code ?? row.shippingLineCode ?? "",
    shippingLineName: row.shipping_line_name ?? row.shippingLineName ?? "",
    itemCount: Number(row.item_count ?? row.itemCount ?? 0),
    chargeableWeightGrams: nullableNumber(row.chargeable_weight_grams ?? row.chargeableWeightGrams),
    finalFeeCents,
    finalFee: centsToMoney(finalFeeCents),
    currency: row.currency || "USD",
    trackingNumber: row.tracking_number ?? row.trackingNumber ?? "",
    paymentStatus: row.payment_status ?? row.paymentStatus ?? "",
    paymentAmountCents,
    paymentAmount: centsToMoney(paymentAmountCents),
    paymentProvider: row.payment_provider ?? row.paymentProvider ?? "",
    submittedAt: toIso(row.submitted_at ?? row.submittedAt),
    paidAt: toIso(row.paid_at ?? row.paidAt),
    shippedAt: toIso(row.shipped_at ?? row.shippedAt),
    deliveredAt: toIso(row.delivered_at ?? row.deliveredAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeAdminPolicy(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    policyType: row.policy_type ?? row.policyType,
    title: row.title,
    body: row.body,
    status: row.status,
    version: Number(row.version || 1),
    publishedAt: toIso(row.published_at ?? row.publishedAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

function paged(rows, normalizer) {
  return {
    items: rows.map(normalizer),
    total: Number(rows[0]?.total_count ?? rows[0]?.totalCount ?? 0)
  };
}

function counts(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
