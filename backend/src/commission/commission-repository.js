import { getDbPool } from "../db/pool.js";

// V2-11-06 — the commission wallet ledger (double-entry, isolated from the normal
// wallet). Account namespace: commission:{userId}:{pending|available|frozen|settled}
// and commission:platform:pool.
export function acct(userId, sub) { return `commission:${userId}:${sub}`; }
export const PLATFORM_POOL = "commission:platform:pool";

export function createPgCommissionRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // Post a balanced transaction. Idempotent on idempotency_key. `entries` are
    // {account, direction, amountMinor} and MUST balance (debits === credits).
    async post({ comNo, promoterUserId, inviteeUserId, businessType, businessRef, idempotencyKey, amountMinor, baseMinor, commissionBps, tierLevel, entries }) {
      const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountMinor, 0);
      const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountMinor, 0);
      if (debit !== credit) { const e = new Error("unbalanced"); e.code = "UNBALANCED"; throw e; }
      const client = await pool().connect();
      try {
        await client.query("begin");
        const existing = (await client.query("select * from commission_transactions where idempotency_key = $1", [idempotencyKey])).rows[0];
        if (existing) { await client.query("rollback"); return { transaction: normalizeTx(existing), created: false }; }
        let tx;
        try {
          tx = (await client.query(
            `insert into commission_transactions (com_no, promoter_user_id, invitee_user_id, business_type, business_ref, idempotency_key, amount_minor, base_minor, commission_bps, tier_level)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
            [comNo, promoterUserId, inviteeUserId || null, businessType, businessRef || "", idempotencyKey, amountMinor, baseMinor || 0, commissionBps || 0, tierLevel || 0]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); const raced = (await pool().query("select * from commission_transactions where idempotency_key = $1", [idempotencyKey])).rows[0]; return { transaction: normalizeTx(raced), created: false }; }
          throw error;
        }
        for (const e of entries) {
          await client.query("insert into commission_entries (transaction_id, account, direction, amount_minor) values ($1, $2, $3, $4)", [tx.id, e.account, e.direction, e.amountMinor]);
        }
        await client.query("commit");
        return { transaction: normalizeTx(tx), created: true };
      } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
    },

    // Recompute an account balance from the ledger.
    async balance(account) {
      const r = await pool().query(
        "select coalesce(sum(case when direction='credit' then amount_minor else -amount_minor end),0)::bigint bal from commission_entries where account = $1",
        [account]
      );
      return Number(r.rows[0].bal);
    },
    async wallet(userId) {
      const r = await pool().query(
        `select
           coalesce(sum(case when account = $1 then (case when direction='credit' then amount_minor else -amount_minor end) else 0 end),0)::bigint pending,
           coalesce(sum(case when account = $2 then (case when direction='credit' then amount_minor else -amount_minor end) else 0 end),0)::bigint available,
           coalesce(sum(case when account = $3 then (case when direction='credit' then amount_minor else -amount_minor end) else 0 end),0)::bigint frozen,
           coalesce(sum(case when account = $4 then (case when direction='credit' then amount_minor else -amount_minor end) else 0 end),0)::bigint settled
         from commission_entries`,
        [acct(userId, "pending"), acct(userId, "available"), acct(userId, "frozen"), acct(userId, "settled")]
      );
      const row = r.rows[0];
      return { pending: Number(row.pending), available: Number(row.available), frozen: Number(row.frozen), settled: Number(row.settled) };
    },
    async listTransactions(promoterUserId, limit = 50) {
      const r = await pool().query("select * from commission_transactions where promoter_user_id = $1 order by created_at desc limit $2", [promoterUserId, Math.min(limit, 100)]);
      return r.rows.map(normalizeTx);
    },
    async findByIdempotencyKey(idempotencyKey) {
      const r = await pool().query("select * from commission_transactions where idempotency_key = $1", [idempotencyKey]);
      return normalizeTx(r.rows[0]);
    },
    async findByBusinessRef(businessType, businessRef) {
      const r = await pool().query("select * from commission_transactions where business_type = $1 and business_ref = $2 order by created_at asc", [businessType, businessRef]);
      return r.rows.map(normalizeTx);
    },
    // Sum of every account (must be 0 for a balanced ledger — recompute check).
    async ledgerSum() {
      const r = await pool().query("select coalesce(sum(case when direction='credit' then amount_minor else -amount_minor end),0)::bigint s from commission_entries");
      return Number(r.rows[0].s);
    },

    // ---- V2-11-10 withdrawal rows ----
    async createWithdrawal({ wdNo, promoterUserId, amountMinor, bankAccountRef, bankLast4, freezeTxId, idempotencyKey }) {
      const r = await pool().query(
        `insert into commission_withdrawals (wd_no, promoter_user_id, amount_minor, bank_account_ref, bank_last4, freeze_tx_id, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [wdNo, promoterUserId, amountMinor, bankAccountRef || "", bankLast4 || "", freezeTxId || null, idempotencyKey || null]
      );
      return normalizeWithdrawal(r.rows[0]);
    },
    async findWithdrawal(id) { const r = await pool().query("select * from commission_withdrawals where id = $1", [id]); return normalizeWithdrawal(r.rows[0]); },
    async listWithdrawals({ status = null, limit = 50 } = {}) {
      const r = await pool().query("select * from commission_withdrawals where ($1::text is null or status = $1) order by created_at desc limit $2", [status, Math.min(limit, 100)]);
      return r.rows.map(normalizeWithdrawal);
    },
    // Guarded status transition (returns null if the from-status no longer holds).
    async setWithdrawalStatus({ id, fromStatus, toStatus, reviewerAdminId, reason, settleTxId, unfreezeTxId }) {
      const r = await pool().query(
        `update commission_withdrawals set status = $3, reviewer_admin_id = coalesce($4, reviewer_admin_id),
           decision_reason = coalesce($5, decision_reason), settle_tx_id = coalesce($6, settle_tx_id), unfreeze_tx_id = coalesce($7, unfreeze_tx_id)
         where id = $1 and status = $2 returning *`,
        [id, fromStatus, toStatus, reviewerAdminId || null, reason || null, settleTxId || null, unfreezeTxId || null]
      );
      return normalizeWithdrawal(r.rows[0]);
    },

    // ---- V2-11-11 qualification + disciplinary ----
    async getQualification(promoterUserId) {
      const r = await pool().query("select * from commission_qualifications where promoter_user_id = $1", [promoterUserId]);
      return r.rows[0] ? { promoterUserId: r.rows[0].promoter_user_id, status: r.rows[0].status, reason: r.rows[0].reason } : { promoterUserId, status: "active", reason: "" };
    },
    async setQualification({ promoterUserId, status, reason }) {
      const r = await pool().query(
        `insert into commission_qualifications (promoter_user_id, status, reason) values ($1, $2, $3)
         on conflict (promoter_user_id) do update set status = excluded.status, reason = excluded.reason returning *`,
        [promoterUserId, status, reason || ""]
      );
      return { promoterUserId: r.rows[0].promoter_user_id, status: r.rows[0].status, reason: r.rows[0].reason };
    },
    async addDisciplinaryRecord({ promoterUserId, action, reason, evidence, adminId }) {
      const r = await pool().query(
        "insert into commission_disciplinary_records (promoter_user_id, action, reason, evidence, actor_admin_id) values ($1, $2, $3, $4, $5) returning *",
        [promoterUserId, action, reason, JSON.stringify(evidence || []), adminId || null]
      );
      return r.rows[0];
    }
  };
}

export function normalizeWithdrawal(row) {
  if (!row) return null;
  return { id: row.id, wdNo: row.wd_no, promoterUserId: row.promoter_user_id, amountMinor: Number(row.amount_minor), bankLast4: row.bank_last4, status: row.status, freezeTxId: row.freeze_tx_id, settleTxId: row.settle_tx_id, decisionReason: row.decision_reason, createdAt: row.created_at };
}

export function normalizeTx(row) {
  if (!row) return null;
  return { id: row.id, comNo: row.com_no, promoterUserId: row.promoter_user_id, inviteeUserId: row.invitee_user_id, businessType: row.business_type, businessRef: row.business_ref, amountMinor: Number(row.amount_minor), baseMinor: Number(row.base_minor), commissionBps: row.commission_bps, tierLevel: row.tier_level, status: row.status, createdAt: row.created_at };
}
