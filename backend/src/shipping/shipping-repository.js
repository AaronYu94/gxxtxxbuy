import { getDbPool } from "../db/pool.js";
import { centsToMoney } from "../core/core-input.js";

export function createPgShippingRepository(env) {
  return {
    async upsertShippingLines(lines) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const line of lines) {
          await client.query(
            `insert into shipping_lines (
              code,
              name,
              destination_country,
              service_level,
              status,
              currency,
              billing_rules,
              restriction_rules,
              delivery_min_days,
              delivery_max_days
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            on conflict (code) do update
            set name = excluded.name,
                destination_country = excluded.destination_country,
                service_level = excluded.service_level,
                status = excluded.status,
                currency = excluded.currency,
                billing_rules = excluded.billing_rules,
                restriction_rules = excluded.restriction_rules,
                delivery_min_days = excluded.delivery_min_days,
                delivery_max_days = excluded.delivery_max_days`,
            [
              line.code,
              line.name,
              line.destinationCountry,
              line.serviceLevel,
              line.status,
              line.currency,
              line.billingRules,
              line.restrictionRules,
              line.deliveryMinDays,
              line.deliveryMaxDays
            ]
          );
        }
        await client.query("commit");
        return { imported: lines.length };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listShippingLines(country = "") {
      const result = await getDbPool(env).query(
        `select * from shipping_lines
         where ($1 = '' or destination_country = $1)
         order by destination_country asc, service_level asc, name asc`,
        [country]
      );
      return result.rows.map(normalizeShippingLine);
    },

    async findShippingLineById(id) {
      const result = await getDbPool(env).query("select * from shipping_lines where id = $1 limit 1", [id]);
      return normalizeShippingLine(result.rows[0]);
    },

    async findShippingLineByCode(code) {
      const result = await getDbPool(env).query("select * from shipping_lines where code = $1 limit 1", [code]);
      return normalizeShippingLine(result.rows[0]);
    },

    async findWarehouseItemsForParcel(userId, warehouseItemIds) {
      const result = await getDbPool(env).query(
        `select
           wi.*,
           h.title,
           h.spec,
           h.price_cents,
           h.currency,
           h.quantity,
           h.source_platform,
           h.source_domain
         from warehouse_items wi
         join haul_items h on h.id = wi.haul_item_id
         where wi.user_id = $1 and wi.id = any($2::uuid[])`,
        [userId, warehouseItemIds]
      );
      return result.rows.map(normalizeParcelWarehouseItem);
    },

    async findActiveParcelByWarehouseItemIds(userId, warehouseItemIds) {
      const result = await getDbPool(env).query(
        `select distinct p.*
         from parcels p
         join parcel_items pi on pi.parcel_id = p.id
         where p.user_id = $1
           and pi.warehouse_item_id = any($2::uuid[])
           and pi.status = 'active'
           and p.status <> 'cancelled'
         order by p.created_at desc
         limit 1`,
        [userId, warehouseItemIds]
      );
      const parcel = normalizeParcel(result.rows[0]);
      if (!parcel) return null;
      return {
        ...parcel,
        items: await this.listParcelItems(parcel.id)
      };
    },

    async createParcelDraft({ userId, warehouseItems }) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const parcelResult = await client.query(
          `insert into parcels (user_id, status)
           values ($1, 'draft')
           returning *`,
          [userId]
        );
        const parcel = normalizeParcel(parcelResult.rows[0]);
        for (const item of warehouseItems) {
          await client.query(
            `insert into parcel_items (
              parcel_id,
              user_id,
              warehouse_item_id,
              haul_item_id,
              weight_grams
            ) values ($1, $2, $3, $4, $5)`,
            [parcel.id, userId, item.id, item.haulItemId, item.weightGrams]
          );
        }
        await client.query(
          `update haul_items
           set status = 'parcel_submitted'
           where user_id = $1 and id = any($2::uuid[])`,
          [userId, warehouseItems.map((item) => item.haulItemId)]
        );
        await client.query("commit");
        return {
          ...parcel,
          items: warehouseItems.map(parcelItemFromWarehouseItem)
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listParcels(userId) {
      const result = await getDbPool(env).query(
        `select * from parcels
         where user_id = $1
         order by created_at desc`,
        [userId]
      );
      const parcels = result.rows.map(normalizeParcel);
      return Promise.all(parcels.map(async (parcel) => ({
        ...parcel,
        items: await this.listParcelItems(parcel.id)
      })));
    },

    async findParcelForUser(userId, parcelId) {
      const result = await getDbPool(env).query(
        "select * from parcels where user_id = $1 and id = $2 limit 1",
        [userId, parcelId]
      );
      const parcel = normalizeParcel(result.rows[0]);
      if (!parcel) return null;
      return {
        ...parcel,
        items: await this.listParcelItems(parcel.id)
      };
    },

    async findParcelById(parcelId) {
      const result = await getDbPool(env).query("select * from parcels where id = $1 limit 1", [parcelId]);
      const parcel = normalizeParcel(result.rows[0]);
      if (!parcel) return null;
      return {
        ...parcel,
        items: await this.listParcelItems(parcel.id)
      };
    },

    async listParcelItems(parcelId) {
      const result = await getDbPool(env).query(
        `select
           pi.*,
           h.title,
           h.spec,
           h.price_cents,
           h.currency,
           h.quantity,
           h.source_platform,
           h.source_domain
         from parcel_items pi
         join haul_items h on h.id = pi.haul_item_id
         where pi.parcel_id = $1 and pi.status = 'active'
         order by pi.created_at asc`,
        [parcelId]
      );
      return result.rows.map(normalizeParcelItem);
    },

    async createQuote(input) {
      const result = await getDbPool(env).query(
        `insert into shipping_quotes (
          user_id,
          parcel_id,
          shipping_line_id,
          destination_country,
          amount_cents,
          currency,
          actual_weight_grams,
          volumetric_weight_grams,
          chargeable_weight_grams,
          line_snapshot,
          item_snapshot,
          expires_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning *`,
        [
          input.userId,
          input.parcelId || null,
          input.shippingLineId,
          input.destinationCountry,
          input.amountCents,
          input.currency,
          input.actualWeightGrams,
          input.volumetricWeightGrams,
          input.chargeableWeightGrams,
          input.lineSnapshot,
          input.itemSnapshot,
          input.expiresAt
        ]
      );
      return normalizeShippingQuote(result.rows[0]);
    },

    async findQuoteForUser(userId, quoteId) {
      const result = await getDbPool(env).query(
        "select * from shipping_quotes where user_id = $1 and id = $2 limit 1",
        [userId, quoteId]
      );
      return normalizeShippingQuote(result.rows[0]);
    },

    async submitParcel(input) {
      const result = await getDbPool(env).query(
        `update parcels
         set status = 'shipping_due',
             shipping_line_id = $3,
             quote_id = $4,
             destination_country = $5,
             recipient_name = $6,
             address = $7,
             chargeable_weight_grams = $8,
             final_fee_cents = $9,
             currency = $10,
             submitted_at = coalesce(submitted_at, now())
         where user_id = $1 and id = $2
         returning *`,
        [
          input.userId,
          input.parcelId,
          input.shippingLineId,
          input.quoteId,
          input.destinationCountry,
          input.recipientName,
          input.address,
          input.chargeableWeightGrams,
          input.finalFeeCents,
          input.currency
        ]
      );
      await getDbPool(env).query("update shipping_quotes set status = 'used' where id = $1", [input.quoteId]);
      const parcel = normalizeParcel(result.rows[0]);
      return {
        ...parcel,
        items: await this.listParcelItems(parcel.id)
      };
    },

    async findPaymentByIdempotency(userId, idempotencyKey) {
      const result = await getDbPool(env).query(
        `select * from shipping_payments
         where user_id = $1 and idempotency_key = $2
         limit 1`,
        [userId, idempotencyKey]
      );
      return normalizeShippingPayment(result.rows[0]);
    },

    async createPayment(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `insert into shipping_payments (
            user_id,
            parcel_id,
            idempotency_key,
            payment_intent_id,
            provider,
            status,
            amount_cents,
            currency
          ) values ($1, $2, $3, $4, 'mock', 'requires_payment', $5, $6)
          returning *`,
          [
            input.userId,
            input.parcelId,
            input.idempotencyKey,
            input.paymentIntentId,
            input.amountCents,
            input.currency
          ]
        );
        await client.query(
          "update parcels set status = 'payment_pending' where user_id = $1 and id = $2 and status = 'shipping_due'",
          [input.userId, input.parcelId]
        );
        await client.query("commit");
        return normalizeShippingPayment(result.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async findPaymentByIntent(paymentIntentId) {
      const result = await getDbPool(env).query(
        "select * from shipping_payments where payment_intent_id = $1 limit 1",
        [paymentIntentId]
      );
      return normalizeShippingPayment(result.rows[0]);
    },

    async findWebhookEvent(eventId) {
      const result = await getDbPool(env).query(
        "select * from payment_webhook_events where event_id = $1 limit 1",
        [eventId]
      );
      return normalizeWebhookEvent(result.rows[0]);
    },

    async applyPaymentWebhook(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const eventResult = await client.query(
          `insert into payment_webhook_events (event_id, payment_intent_id, status, payload)
           values ($1, $2, $3, $4)
           on conflict (event_id) do nothing
           returning *`,
          [input.eventId, input.paymentIntentId, input.status, input.payload]
        );
        if (!eventResult.rows[0]) {
          await client.query("rollback");
          return { event: await this.findWebhookEvent(input.eventId), duplicate: true };
        }

        const paymentResult = await client.query(
          `update shipping_payments
           set status = $2
           where payment_intent_id = $1
           returning *`,
          [input.paymentIntentId, input.status]
        );
        const payment = normalizeShippingPayment(paymentResult.rows[0]);
        if (payment?.status === "succeeded") {
          await client.query(
            `update parcels
             set status = 'paid',
                 paid_at = coalesce(paid_at, now())
             where id = $1`,
            [payment.parcelId]
          );
        } else if (["failed", "cancelled"].includes(payment?.status)) {
          await client.query(
            `update parcels
             set status = 'shipping_due'
             where id = $1 and status = 'payment_pending'`,
            [payment.parcelId]
          );
        }
        await client.query("commit");
        return {
          event: normalizeWebhookEvent(eventResult.rows[0]),
          payment,
          duplicate: false
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async updateParcelStatus(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `update parcels
           set status = $2,
               tracking_number = coalesce(nullif($3, ''), tracking_number),
               shipped_at = case when $2 in ('dispatched', 'in_transit') then coalesce(shipped_at, now()) else shipped_at end,
               delivered_at = case when $2 = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
           where id = $1
           returning *`,
          [input.parcelId, input.status, input.trackingNumber || ""]
        );
        if (input.status === "cancelled") {
          await client.query(
            `update parcel_items set status = 'removed'
             where parcel_id = $1 and status = 'active'`,
            [input.parcelId]
          );
        }
        const parcel = normalizeParcel(result.rows[0]);
        await client.query("commit");
        return {
          ...parcel,
          items: await this.listParcelItems(parcel.id)
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async addTrackingEvent(input) {
      const result = await getDbPool(env).query(
        `insert into tracking_events (
          parcel_id,
          user_id,
          status,
          location,
          message,
          occurred_at,
          created_by_admin_user_id
        ) values ($1, $2, $3, $4, $5, coalesce($6, now()), $7)
        returning *`,
        [
          input.parcelId,
          input.userId,
          input.status,
          input.location || "",
          input.message || "",
          input.occurredAt || null,
          input.createdByAdminUserId || null
        ]
      );
      return normalizeTrackingEvent(result.rows[0]);
    },

    async listTrackingEvents(userId, parcelId) {
      const result = await getDbPool(env).query(
        `select * from tracking_events
         where user_id = $1 and parcel_id = $2
         order by occurred_at asc`,
        [userId, parcelId]
      );
      return result.rows.map(normalizeTrackingEvent);
    }
  };
}

export function normalizeShippingLine(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    code: row.code,
    name: row.name,
    destinationCountry: row.destination_country ?? row.destinationCountry,
    serviceLevel: row.service_level ?? row.serviceLevel ?? "standard",
    status: row.status || "active",
    currency: row.currency || "USD",
    billingRules: row.billing_rules ?? row.billingRules ?? {},
    restrictionRules: row.restriction_rules ?? row.restrictionRules ?? {},
    deliveryMinDays: nullableNumber(row.delivery_min_days ?? row.deliveryMinDays),
    deliveryMaxDays: nullableNumber(row.delivery_max_days ?? row.deliveryMaxDays),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeParcelWarehouseItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    purchaseOrderId: String(row.purchase_order_id ?? row.purchaseOrderId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    status: row.status,
    weightGrams: Number(row.weight_grams ?? row.weightGrams ?? 0),
    title: row.title || "",
    spec: row.spec || "",
    priceCents: row.price_cents ?? row.priceCents ?? 0,
    price: centsToMoney(row.price_cents ?? row.priceCents ?? 0),
    currency: row.currency || "USD",
    quantity: Number(row.quantity || 1),
    sourcePlatform: row.source_platform ?? row.sourcePlatform ?? "Other",
    sourceDomain: row.source_domain ?? row.sourceDomain ?? "",
    receivedAt: toIso(row.received_at ?? row.receivedAt)
  };
}

export function normalizeParcel(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    addressId: row.address_id ?? row.addressId ?? null,
    shippingLineId: row.shipping_line_id ? String(row.shipping_line_id) : row.shippingLineId || null,
    quoteId: row.quote_id ? String(row.quote_id) : row.quoteId || null,
    status: row.status,
    destinationCountry: row.destination_country ?? row.destinationCountry ?? "",
    recipientName: row.recipient_name ?? row.recipientName ?? "",
    address: row.address || {},
    chargeableWeightGrams: nullableNumber(row.chargeable_weight_grams ?? row.chargeableWeightGrams),
    finalFeeCents: nullableNumber(row.final_fee_cents ?? row.finalFeeCents),
    finalFee: centsToMoney(row.final_fee_cents ?? row.finalFeeCents),
    currency: row.currency || "USD",
    trackingNumber: row.tracking_number ?? row.trackingNumber ?? "",
    submittedAt: toIso(row.submitted_at ?? row.submittedAt),
    paidAt: toIso(row.paid_at ?? row.paidAt),
    shippedAt: toIso(row.shipped_at ?? row.shippedAt),
    deliveredAt: toIso(row.delivered_at ?? row.deliveredAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeParcelItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    parcelId: String(row.parcel_id ?? row.parcelId),
    userId: String(row.user_id ?? row.userId),
    warehouseItemId: String(row.warehouse_item_id ?? row.warehouseItemId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    weightGrams: Number(row.weight_grams ?? row.weightGrams ?? 0),
    status: row.status || "active",
    title: row.title || "",
    spec: row.spec || "",
    priceCents: row.price_cents ?? row.priceCents ?? 0,
    price: centsToMoney(row.price_cents ?? row.priceCents ?? 0),
    currency: row.currency || "USD",
    quantity: Number(row.quantity || 1),
    sourcePlatform: row.source_platform ?? row.sourcePlatform ?? "Other",
    sourceDomain: row.source_domain ?? row.sourceDomain ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizeShippingQuote(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    parcelId: row.parcel_id ? String(row.parcel_id) : row.parcelId || null,
    shippingLineId: String(row.shipping_line_id ?? row.shippingLineId),
    destinationCountry: row.destination_country ?? row.destinationCountry,
    status: row.status,
    amountCents: Number(row.amount_cents ?? row.amountCents),
    amount: centsToMoney(row.amount_cents ?? row.amountCents),
    currency: row.currency || "USD",
    actualWeightGrams: Number(row.actual_weight_grams ?? row.actualWeightGrams),
    volumetricWeightGrams: Number(row.volumetric_weight_grams ?? row.volumetricWeightGrams),
    chargeableWeightGrams: Number(row.chargeable_weight_grams ?? row.chargeableWeightGrams),
    lineSnapshot: row.line_snapshot ?? row.lineSnapshot ?? {},
    itemSnapshot: row.item_snapshot ?? row.itemSnapshot ?? [],
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizeShippingPayment(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    parcelId: String(row.parcel_id ?? row.parcelId),
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey,
    paymentIntentId: row.payment_intent_id ?? row.paymentIntentId,
    provider: row.provider || "mock",
    status: row.status,
    amountCents: Number(row.amount_cents ?? row.amountCents),
    amount: centsToMoney(row.amount_cents ?? row.amountCents),
    currency: row.currency || "USD",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeWebhookEvent(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    eventId: row.event_id ?? row.eventId,
    paymentIntentId: row.payment_intent_id ?? row.paymentIntentId,
    status: row.status,
    payload: row.payload || {},
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizeTrackingEvent(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    parcelId: String(row.parcel_id ?? row.parcelId),
    userId: String(row.user_id ?? row.userId),
    status: row.status,
    location: row.location || "",
    message: row.message || "",
    occurredAt: toIso(row.occurred_at ?? row.occurredAt),
    createdByAdminUserId: row.created_by_admin_user_id ? String(row.created_by_admin_user_id) : row.createdByAdminUserId || null,
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

function parcelItemFromWarehouseItem(item) {
  return {
    id: "",
    parcelId: "",
    userId: item.userId,
    warehouseItemId: item.id,
    haulItemId: item.haulItemId,
    weightGrams: item.weightGrams,
    status: "active",
    title: item.title,
    spec: item.spec,
    priceCents: item.priceCents,
    price: item.price,
    currency: item.currency,
    quantity: item.quantity,
    sourcePlatform: item.sourcePlatform,
    sourceDomain: item.sourceDomain,
    createdAt: new Date().toISOString()
  };
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
