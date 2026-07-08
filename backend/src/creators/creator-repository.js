import { getDbPool } from "../db/pool.js";

export function createPgCreatorRepository(env) {
  return {
    async createCreator(input) {
      const result = await getDbPool(env).query(
        `insert into creators (user_id, code, display_name, status, created_by_admin_user_id)
         values ($1, $2, $3, $4, $5)
         on conflict (code) do update set display_name = excluded.display_name
         returning *`,
        [input.userId || null, input.code, input.displayName || "", input.status || "active", input.createdByAdminUserId || null]
      );
      return normalizeCreator(result.rows[0]);
    },

    async findCreatorById(id) {
      const result = await getDbPool(env).query("select * from creators where id = $1 limit 1", [id]);
      return normalizeCreator(result.rows[0]);
    },

    async findCreatorByCode(code) {
      const result = await getDbPool(env).query("select * from creators where code = $1 limit 1", [code]);
      return normalizeCreator(result.rows[0]);
    },

    async findCreatorByUserId(userId) {
      const result = await getDbPool(env).query("select * from creators where user_id = $1 limit 1", [userId]);
      return normalizeCreator(result.rows[0]);
    },

    async createCampaign(input) {
      const result = await getDbPool(env).query(
        `insert into creator_campaigns (creator_id, code, name, landing_url, status)
         values ($1, $2, $3, $4, $5)
         on conflict (code) do update set name = excluded.name, landing_url = excluded.landing_url
         returning *`,
        [input.creatorId, input.code, input.name || "", input.landingUrl || "", input.status || "active"]
      );
      return normalizeCampaign(result.rows[0]);
    },

    async findCampaignByCode(code) {
      const result = await getDbPool(env).query("select * from creator_campaigns where code = $1 limit 1", [code]);
      return normalizeCampaign(result.rows[0]);
    },

    async listCreatorCampaigns(creatorId) {
      const result = await getDbPool(env).query(
        "select * from creator_campaigns where creator_id = $1 order by created_at desc",
        [creatorId]
      );
      return result.rows.map(normalizeCampaign);
    },

    async recordAttribution(input) {
      const result = await getDbPool(env).query(
        `insert into creator_attributions (creator_id, campaign_id, session_id, user_id, purchase_order_id, touch_type)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (creator_id, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), session_id, touch_type)
         do update set user_id = coalesce(creator_attributions.user_id, excluded.user_id)
         returning *`,
        [
          input.creatorId,
          input.campaignId || null,
          input.sessionId || "",
          input.userId || null,
          input.purchaseOrderId || null,
          input.touchType || "visit"
        ]
      );
      return normalizeAttribution(result.rows[0]);
    },

    async getCreatorStats(creatorId) {
      const result = await getDbPool(env).query(
        `select touch_type, count(*)::int as total
         from creator_attributions
         where creator_id = $1
         group by touch_type`,
        [creatorId]
      );
      return foldStats(result.rows);
    }
  };
}

export function normalizeCreator(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId ?? null,
    code: row.code,
    displayName: row.display_name ?? row.displayName ?? "",
    status: row.status,
    createdByAdminUserId: row.created_by_admin_user_id ?? row.createdByAdminUserId ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

export function normalizeCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    creatorId: row.creator_id ?? row.creatorId,
    code: row.code,
    name: row.name ?? "",
    landingUrl: row.landing_url ?? row.landingUrl ?? "",
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

export function normalizeAttribution(row) {
  if (!row) return null;
  return {
    id: row.id,
    creatorId: row.creator_id ?? row.creatorId,
    campaignId: row.campaign_id ?? row.campaignId ?? null,
    sessionId: row.session_id ?? row.sessionId ?? "",
    userId: row.user_id ?? row.userId ?? null,
    purchaseOrderId: row.purchase_order_id ?? row.purchaseOrderId ?? null,
    touchType: row.touch_type ?? row.touchType ?? "visit",
    createdAt: row.created_at ?? row.createdAt
  };
}

export function foldStats(rows) {
  const stats = { visits: 0, signups: 0, orders: 0 };
  for (const row of rows) {
    if (row.touch_type === "visit") stats.visits = Number(row.total) || 0;
    if (row.touch_type === "signup") stats.signups = Number(row.total) || 0;
    if (row.touch_type === "order") stats.orders = Number(row.total) || 0;
  }
  return stats;
}
