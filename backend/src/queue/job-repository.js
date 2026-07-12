import { getDbPool } from "../db/pool.js";

// V2-12-02 — job idempotency + dead-letter store.
export function createPgJobRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async isProcessed(idempotencyKey) {
      const r = await pool().query("select 1 from processed_jobs where idempotency_key = $1", [idempotencyKey]);
      return r.rowCount > 0;
    },
    async markProcessed(idempotencyKey, jobType) {
      try {
        await pool().query("insert into processed_jobs (idempotency_key, job_type) values ($1, $2) on conflict do nothing", [idempotencyKey, jobType || ""]);
        return true;
      } catch { return false; }
    },
    async deadLetter({ jobType, idempotencyKey, envelope, error, attempts }) {
      const r = await pool().query(
        "insert into dead_letter_jobs (job_type, idempotency_key, envelope, error, attempts) values ($1, $2, $3, $4, $5) returning *",
        [jobType, idempotencyKey, JSON.stringify(envelope || {}), String(error || "").slice(0, 2000), attempts || 0]
      );
      return normalizeDlq(r.rows[0]);
    },
    async findDeadLetter(id) { const r = await pool().query("select * from dead_letter_jobs where id = $1", [id]); return normalizeDlq(r.rows[0]); },
    async listDeadLetters({ status = "dead", limit = 50 } = {}) {
      const r = await pool().query("select * from dead_letter_jobs where ($1::text is null or status = $1) order by created_at desc limit $2", [status, Math.min(limit, 100)]);
      return r.rows.map(normalizeDlq);
    },
    async markDeadLetter(id, { status, adminId }) {
      const r = await pool().query("update dead_letter_jobs set status = $2, replayed_by_admin_id = coalesce($3, replayed_by_admin_id) where id = $1 and status = 'dead' returning *", [id, status, adminId || null]);
      return normalizeDlq(r.rows[0]);
    },
    async deadLetterCount() {
      const r = await pool().query("select count(*)::int c from dead_letter_jobs where status = 'dead'");
      return r.rows[0].c;
    }
  };
}

function normalizeDlq(row) {
  if (!row) return null;
  return { id: row.id, jobType: row.job_type, idempotencyKey: row.idempotency_key, envelope: row.envelope || {}, error: row.error, attempts: row.attempts, status: row.status, createdAt: row.created_at };
}
