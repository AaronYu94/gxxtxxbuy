import { getDbPool } from "../db/pool.js";

// V2-10-18 — notification dispatch log (idempotent) + dead-letter handling.
export function createPgNotificationRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // Idempotent dispatch: a duplicate event_key returns the existing row.
    async dispatch({ eventKey, type, userId, channel, category, status, detail }) {
      try {
        const r = await pool().query(
          `insert into notification_dispatches (event_key, type, user_id, channel, category, status, detail)
           values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [eventKey, type, userId || null, channel || "email", category || "transactional", status || "sent", JSON.stringify(detail || {})]
        );
        return { dispatch: normalize(r.rows[0]), created: true };
      } catch (error) {
        if (error.code === "23505") {
          const existing = (await pool().query("select * from notification_dispatches where event_key = $1", [eventKey])).rows[0];
          return { dispatch: normalize(existing), created: false };
        }
        throw error;
      }
    },
    async markFailed(eventKey) {
      const r = await pool().query(
        "update notification_dispatches set status = 'failed', attempts = attempts + 1 where event_key = $1 returning *", [eventKey]
      );
      return normalize(r.rows[0]);
    },
    async markDead(eventKey) {
      const r = await pool().query("update notification_dispatches set status = 'dead' where event_key = $1 returning *", [eventKey]);
      return normalize(r.rows[0]);
    },
    async listDeadLetters(limit = 50) {
      const r = await pool().query("select * from notification_dispatches where status = 'dead' order by updated_at desc limit $1", [Math.min(limit, 100)]);
      return r.rows.map(normalize);
    },
    async find(eventKey) { const r = await pool().query("select * from notification_dispatches where event_key = $1", [eventKey]); return normalize(r.rows[0]); }
  };
}

function normalize(row) {
  if (!row) return null;
  return { id: row.id, eventKey: row.event_key, type: row.type, userId: row.user_id, channel: row.channel, category: row.category, status: row.status, attempts: row.attempts, createdAt: row.created_at };
}
