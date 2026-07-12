import { getDbPool } from "../db/pool.js";

// V2-09-05/06 — membership config versions + growth-value ledger.
export function createPgMembershipRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- config versions ----
    async setActiveConfig({ tiers, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const prev = (await client.query("select coalesce(max(version), 0) v from membership_config_versions")).rows[0];
        await client.query("update membership_config_versions set active = false where active");
        const row = (await client.query(
          "insert into membership_config_versions (version, tiers, active, created_by_admin_id) values ($1, $2, true, $3) returning *",
          [Number(prev.v) + 1, JSON.stringify(tiers || []), adminId || null]
        )).rows[0];
        await client.query("commit");
        return normalizeConfig(row);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async getActiveConfig() {
      const r = await pool().query("select * from membership_config_versions where active order by version desc limit 1");
      return normalizeConfig(r.rows[0]);
    },
    async listConfigVersions() {
      const r = await pool().query("select * from membership_config_versions order by version desc");
      return r.rows.map(normalizeConfig);
    },

    // ---- growth ledger (idempotent accrual) ----
    async accrue({ userId, deltaMinor, source, businessType, businessRef, idempotencyKey }) {
      try {
        const r = await pool().query(
          `insert into membership_growth_ledger (user_id, delta_growth_minor, source, business_type, business_ref, idempotency_key)
           values ($1, $2, $3, $4, $5, $6) returning *`,
          [userId, deltaMinor, source, businessType || "", businessRef || "", idempotencyKey]
        );
        return { entry: normalizeLedger(r.rows[0]), created: true };
      } catch (error) {
        if (error.code === "23505") return { entry: null, created: false }; // replayed event
        throw error;
      }
    },
    async totalGrowth(userId) {
      const r = await pool().query("select coalesce(sum(delta_growth_minor), 0)::bigint total from membership_growth_ledger where user_id = $1", [userId]);
      return Number(r.rows[0]?.total || 0);
    },
    async listLedger(userId, limit = 50) {
      const r = await pool().query("select * from membership_growth_ledger where user_id = $1 order by created_at desc limit $2", [userId, Math.min(limit, 100)]);
      return r.rows.map(normalizeLedger);
    }
  };
}

export function normalizeConfig(row) {
  if (!row) return null;
  return { id: row.id, version: row.version, tiers: row.tiers || [], active: row.active, effectiveAt: row.effective_at, createdAt: row.created_at };
}
export function normalizeLedger(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, deltaGrowthMinor: Number(row.delta_growth_minor), source: row.source, businessType: row.business_type, businessRef: row.business_ref, createdAt: row.created_at };
}
