import { getDbPool } from "../db/pool.js";
import { centsToMoney } from "./core-input.js";

export function createPgCoreRepository(env) {
  return {
    async findSavedLinkByHash(userId, urlHash) {
      const result = await getDbPool(env).query(
        `select * from saved_links where user_id = $1 and url_hash = $2 limit 1`,
        [userId, urlHash]
      );
      return normalizeSavedLink(result.rows[0]);
    },

    async findSavedLinkById(userId, linkId) {
      const result = await getDbPool(env).query(
        `select * from saved_links where user_id = $1 and id = $2 limit 1`,
        [userId, linkId]
      );
      return normalizeSavedLink(result.rows[0]);
    },

    async createSavedLink(input) {
      const result = await getDbPool(env).query(
        `insert into saved_links (user_id, url, url_hash, domain, platform, status)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [input.userId, input.url, input.urlHash, input.domain, input.platform, input.status]
      );
      return normalizeSavedLink(result.rows[0]);
    },

    async updateSavedLink(userId, linkId, patch) {
      const result = await getDbPool(env).query(
        `update saved_links
         set title = coalesce($3, title),
             spec = coalesce($4, spec),
             price_cents = coalesce($5, price_cents),
             currency = coalesce($6, currency),
             quantity = coalesce($7, quantity),
             note = coalesce($8, note),
             status = coalesce($9, status),
             parse_error = coalesce($10, parse_error)
         where user_id = $1 and id = $2
         returning *`,
        [
          userId,
          linkId,
          patch.title ?? null,
          patch.spec ?? null,
          patch.priceCents ?? null,
          patch.currency ?? null,
          patch.quantity ?? null,
          patch.note ?? null,
          patch.status ?? null,
          patch.parseError ?? null
        ]
      );
      return normalizeSavedLink(result.rows[0]);
    },

    async listSavedLinks(userId) {
      const result = await getDbPool(env).query(
        `select * from saved_links
         where user_id = $1
         order by created_at desc`,
        [userId]
      );
      return result.rows.map(normalizeSavedLink);
    },

    async findHaulItemByLink(userId, linkId) {
      const result = await getDbPool(env).query(
        `select * from haul_items where user_id = $1 and saved_link_id = $2 limit 1`,
        [userId, linkId]
      );
      return normalizeHaulItem(result.rows[0]);
    },

    async findHaulItemById(userId, itemId) {
      const result = await getDbPool(env).query(
        `select * from haul_items where user_id = $1 and id = $2 limit 1`,
        [userId, itemId]
      );
      return normalizeHaulItem(result.rows[0]);
    },

    async createHaulItem(input) {
      const result = await getDbPool(env).query(
        `insert into haul_items (
          user_id,
          saved_link_id,
          title,
          spec,
          price_cents,
          currency,
          quantity,
          note,
          source_platform,
          source_domain,
          status
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting_purchase')
        returning *`,
        [
          input.userId,
          input.savedLinkId,
          input.title,
          input.spec,
          input.priceCents,
          input.currency,
          input.quantity,
          input.note || "",
          input.sourcePlatform,
          input.sourceDomain
        ]
      );
      return normalizeHaulItem(result.rows[0]);
    },

    async updateHaulItemStatus(userId, itemId, status) {
      const result = await getDbPool(env).query(
        `update haul_items set status = $3
         where user_id = $1 and id = $2
         returning *`,
        [userId, itemId, status]
      );
      return normalizeHaulItem(result.rows[0]);
    },

    async listHaulItems(userId, status = "") {
      const result = await getDbPool(env).query(
        `select * from haul_items
         where user_id = $1 and ($2 = '' or status = $2)
         order by created_at desc`,
        [userId, status]
      );
      return result.rows.map(normalizeHaulItem);
    },

    async findPurchaseOrderByItem(userId, itemId) {
      const result = await getDbPool(env).query(
        `select * from purchase_orders where user_id = $1 and haul_item_id = $2 limit 1`,
        [userId, itemId]
      );
      return normalizePurchaseOrder(result.rows[0]);
    },

    async createPurchaseOrder(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const orderResult = await client.query(
          `insert into purchase_orders (user_id, haul_item_id, status)
           values ($1, $2, 'submitted')
           returning *`,
          [input.userId, input.haulItemId]
        );
        await client.query(
          `update haul_items set status = 'purchasing'
           where user_id = $1 and id = $2`,
          [input.userId, input.haulItemId]
        );
        await client.query(
          `insert into order_status_history (
            order_id,
            user_id,
            from_status,
            to_status,
            changed_by_type,
            changed_by_user_id,
            reason
          ) values ($1, $2, null, 'submitted', 'user', $2, $3)`,
          [orderResult.rows[0].id, input.userId, input.reason || "purchase_submitted"]
        );
        await client.query("commit");
        return normalizePurchaseOrder(orderResult.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listPurchaseOrders(userId) {
      const result = await getDbPool(env).query(
        `select * from purchase_orders
         where user_id = $1
         order by created_at desc`,
        [userId]
      );
      return result.rows.map(normalizePurchaseOrder);
    },

    async findPurchaseOrderById(userId, orderId) {
      const result = await getDbPool(env).query(
        `select * from purchase_orders where user_id = $1 and id = $2 limit 1`,
        [userId, orderId]
      );
      return normalizePurchaseOrder(result.rows[0]);
    },

    async listOrderHistory(userId, orderId) {
      const result = await getDbPool(env).query(
        `select * from order_status_history
         where user_id = $1 and order_id = $2
         order by created_at asc`,
        [userId, orderId]
      );
      return result.rows.map(normalizeOrderHistory);
    },

    async listPublishedPolicies() {
      const result = await getDbPool(env).query(
        `select * from policy_pages
         where status = 'published'
         order by policy_type asc`
      );
      return result.rows.map(normalizePolicyPage);
    }
  };
}

export function normalizeSavedLink(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    url: row.url,
    urlHash: row.url_hash ?? row.urlHash,
    domain: row.domain || "",
    platform: row.platform || "Other",
    status: row.status,
    title: row.title || "",
    spec: row.spec || "",
    priceCents: row.price_cents ?? row.priceCents ?? null,
    price: centsToMoney(row.price_cents ?? row.priceCents),
    currency: row.currency || "USD",
    quantity: Number(row.quantity || 1),
    note: row.note || "",
    parseError: row.parse_error ?? row.parseError ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeHaulItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    savedLinkId: String(row.saved_link_id ?? row.savedLinkId),
    title: row.title,
    spec: row.spec,
    priceCents: row.price_cents ?? row.priceCents,
    price: centsToMoney(row.price_cents ?? row.priceCents),
    currency: row.currency || "USD",
    quantity: Number(row.quantity),
    note: row.note || "",
    sourcePlatform: row.source_platform ?? row.sourcePlatform ?? "Other",
    sourceDomain: row.source_domain ?? row.sourceDomain ?? "",
    status: row.status,
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizePurchaseOrder(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    haulItemId: String(row.haul_item_id ?? row.haulItemId),
    status: row.status,
    exception: row.exception || "",
    externalOrderNo: row.external_order_no ?? row.externalOrderNo ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeOrderHistory(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    orderId: String(row.order_id ?? row.orderId),
    userId: String(row.user_id ?? row.userId),
    fromStatus: row.from_status ?? row.fromStatus ?? null,
    toStatus: row.to_status ?? row.toStatus,
    changedByType: row.changed_by_type ?? row.changedByType,
    reason: row.reason || "",
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizePolicyPage(row) {
  if (!row) return null;
  return {
    id: row.id ? String(row.id) : "",
    policyType: row.policy_type ?? row.policyType,
    title: row.title,
    body: row.body,
    status: row.status,
    version: Number(row.version || 1),
    publishedAt: toIso(row.published_at ?? row.publishedAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
