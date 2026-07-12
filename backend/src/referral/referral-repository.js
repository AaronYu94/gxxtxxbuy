import { getDbPool } from "../db/pool.js";

// V2-11-01/02/03 — referral codes + invitation bindings.
export function createPgReferralRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // Return the user's code, creating it once. Concurrent creates converge on one
    // code via the per-user unique index.
    async ensureCode(userId, code) {
      const existing = (await pool().query("select * from referral_codes where user_id = $1", [userId])).rows[0];
      if (existing) return normalizeCode(existing);
      try {
        const r = await pool().query("insert into referral_codes (user_id, code) values ($1, $2) returning *", [userId, code]);
        return normalizeCode(r.rows[0]);
      } catch (e) {
        if (e.code === "23505") { const raced = (await pool().query("select * from referral_codes where user_id = $1", [userId])).rows[0]; return normalizeCode(raced); }
        throw e;
      }
    },
    async findCodeByUser(userId) { const r = await pool().query("select * from referral_codes where user_id = $1", [userId]); return normalizeCode(r.rows[0]); },
    async findCode(code) { const r = await pool().query("select * from referral_codes where code = $1", [code]); return normalizeCode(r.rows[0]); },

    async findBindingByInvitee(inviteeId) { const r = await pool().query("select * from referral_bindings where invitee_user_id = $1", [inviteeId]); return normalizeBinding(r.rows[0]); },
    async findInviterChain(userId, maxDepth = 20) {
      // Walk up the inviter chain (for cycle detection).
      const chain = [];
      let cur = userId;
      for (let i = 0; i < maxDepth; i += 1) {
        const b = (await pool().query("select inviter_user_id from referral_bindings where invitee_user_id = $1", [cur])).rows[0];
        if (!b) break;
        chain.push(b.inviter_user_id);
        cur = b.inviter_user_id;
      }
      return chain;
    },
    async createBinding({ inviteeId, inviterId, code, source }) {
      try {
        const r = await pool().query(
          "insert into referral_bindings (invitee_user_id, inviter_user_id, code, source) values ($1, $2, $3, $4) returning *",
          [inviteeId, inviterId, code || "", source || "signup"]
        );
        return { binding: normalizeBinding(r.rows[0]), created: true };
      } catch (e) {
        if (e.code === "23505") { const existing = (await pool().query("select * from referral_bindings where invitee_user_id = $1", [inviteeId])).rows[0]; return { binding: normalizeBinding(existing), created: false }; }
        throw e;
      }
    },
    async recordAttempt({ inviteeId, code, reason }) {
      await pool().query("insert into referral_binding_attempts (invitee_user_id, code, reason) values ($1, $2, $3)", [inviteeId || null, code || "", reason]);
    },
    async listInvitees(inviterId) {
      const r = await pool().query("select invitee_user_id, created_at from referral_bindings where inviter_user_id = $1 order by created_at desc", [inviterId]);
      return r.rows.map((x) => ({ inviteeId: x.invitee_user_id, createdAt: x.created_at }));
    },
    async countInvitees(inviterId) {
      const r = await pool().query("select count(*)::int c from referral_bindings where inviter_user_id = $1", [inviterId]);
      return r.rows[0].c;
    },
    async findInviterOf(inviteeId) {
      const r = await pool().query("select inviter_user_id from referral_bindings where invitee_user_id = $1", [inviteeId]);
      return r.rows[0] ? r.rows[0].inviter_user_id : null;
    },

    // ---- V2-11-04 tier config versions ----
    async setActiveTierConfig({ tiers, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const prev = (await client.query("select coalesce(max(version), 0) v from referral_tier_config_versions")).rows[0];
        await client.query("update referral_tier_config_versions set active = false where active");
        const row = (await client.query(
          "insert into referral_tier_config_versions (version, tiers, active, created_by_admin_id) values ($1, $2, true, $3) returning *",
          [Number(prev.v) + 1, JSON.stringify(tiers || []), adminId || null]
        )).rows[0];
        await client.query("commit");
        return normalizeTierConfig(row);
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    async getActiveTierConfig() {
      const r = await pool().query("select * from referral_tier_config_versions where active order by version desc limit 1");
      return normalizeTierConfig(r.rows[0]);
    },
    async listTierConfigVersions() { return (await pool().query("select * from referral_tier_config_versions order by version desc")).rows.map(normalizeTierConfig); },

    // ---- V2-11-05 effective-amount ledger (idempotent) ----
    async accrueEffective({ promoterId, deltaMinor, source, businessRef, idempotencyKey }) {
      try {
        const r = await pool().query(
          "insert into referral_effective_ledger (promoter_user_id, delta_minor, source, business_ref, idempotency_key) values ($1, $2, $3, $4, $5) returning *",
          [promoterId, deltaMinor, source, businessRef || "", idempotencyKey]
        );
        return { entry: r.rows[0], created: true };
      } catch (e) { if (e.code === "23505") return { entry: null, created: false }; throw e; }
    },
    async totalEffective(promoterId) {
      const r = await pool().query("select coalesce(sum(delta_minor), 0)::bigint total from referral_effective_ledger where promoter_user_id = $1", [promoterId]);
      return Number(r.rows[0].total);
    },
    async listEffective(promoterId, limit = 50) {
      const r = await pool().query("select * from referral_effective_ledger where promoter_user_id = $1 order by created_at desc limit $2", [promoterId, Math.min(limit, 100)]);
      return r.rows.map((x) => ({ deltaMinor: Number(x.delta_minor), source: x.source, businessRef: x.business_ref, createdAt: x.created_at }));
    }
  };
}

export function normalizeTierConfig(row) {
  return row ? { id: row.id, version: row.version, tiers: row.tiers || [], active: row.active, effectiveAt: row.effective_at, createdAt: row.created_at } : null;
}

export function normalizeCode(row) { return row ? { id: row.id, userId: row.user_id, code: row.code, createdAt: row.created_at } : null; }
export function normalizeBinding(row) { return row ? { id: row.id, inviteeUserId: row.invitee_user_id, inviterUserId: row.inviter_user_id, code: row.code, source: row.source, createdAt: row.created_at } : null; }
