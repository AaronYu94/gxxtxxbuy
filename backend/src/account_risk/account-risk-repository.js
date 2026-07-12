import { getDbPool } from "../db/pool.js";

// V2-09-08/09/10 — account risk events, lock requests, approval + status history.
export function createPgAccountRiskRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- V2-09-08 risk events (idempotent) ----
    async recordEvent({ userId, type, severity, detail, evidenceRef, autoRule, externalId }) {
      try {
        const r = await pool().query(
          `insert into account_risk_events (user_id, type, severity, detail, evidence_ref, auto_rule, external_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [userId, type, severity || "low", JSON.stringify(detail || {}), evidenceRef || "", autoRule || "", externalId]
        );
        return { event: normalizeEvent(r.rows[0]), created: true };
      } catch (error) {
        if (error.code === "23505") return { event: null, created: false }; // replayed event
        throw error;
      }
    },
    async listEvents(userId, limit = 50) {
      const r = await pool().query("select * from account_risk_events where user_id = $1 order by created_at desc limit $2", [userId, Math.min(limit, 100)]);
      return r.rows.map(normalizeEvent);
    },

    // ---- V2-09-09 lock requests ----
    async createLockRequest({ userId, targetStatus, reason, evidence, adminId }) {
      try {
        const r = await pool().query(
          `insert into account_lock_requests (user_id, target_status, reason, evidence, initiated_by_admin_id)
           values ($1, $2, $3, $4, $5) returning *`,
          [userId, targetStatus, reason, JSON.stringify(evidence || []), adminId || null]
        );
        return { request: normalizeRequest(r.rows[0]), created: true };
      } catch (error) {
        if (error.code === "23505") { const e = new Error("dup"); e.code = "ACTIVE_REQUEST_EXISTS"; throw e; }
        throw error;
      }
    },
    async findRequestById(id) { const r = await pool().query("select * from account_lock_requests where id = $1", [id]); return normalizeRequest(r.rows[0]); },
    async listRequests({ status = null, limit = 50 } = {}) {
      const r = await pool().query(
        "select * from account_lock_requests where ($1::text is null or status = $1) order by created_at desc limit $2",
        [status, Math.min(limit, 100)]
      );
      return r.rows.map(normalizeRequest);
    },

    // ---- V2-09-10 approve (lock the account) / reject / unlock ----
    // Approving flips users.status and records status history in one transaction.
    async approveAndLock({ requestId, approverAdminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const req = (await client.query("select * from account_lock_requests where id = $1 for update", [requestId])).rows[0];
        if (!req) { await client.query("rollback"); return { notFound: true }; }
        if (req.status !== "pending_review") { await client.query("rollback"); return { conflict: true, status: req.status }; }
        const user = (await client.query("select id, status from users where id = $1 for update", [req.user_id])).rows[0];
        if (!user) { await client.query("rollback"); return { userNotFound: true }; }
        const fromStatus = user.status;
        await client.query("update users set status = $2, version = version + 1 where id = $1", [req.user_id, req.target_status]);
        const updated = (await client.query(
          "update account_lock_requests set status = 'approved', approver_admin_id = $2, decided_at = now() where id = $1 returning *",
          [requestId, approverAdminId]
        )).rows[0];
        await client.query(
          `insert into account_status_history (user_id, from_status, to_status, action, actor_admin_id, reason, lock_request_id)
           values ($1, $2, $3, 'lock_approved', $4, $5, $6)`,
          [req.user_id, fromStatus, req.target_status, approverAdminId || null, req.reason, requestId]
        );
        await client.query("commit");
        return { request: normalizeRequest(updated), fromStatus, toStatus: req.target_status, userId: req.user_id };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async rejectRequest({ requestId, approverAdminId, reason }) {
      const r = await pool().query(
        "update account_lock_requests set status = 'rejected', approver_admin_id = $2, decision_reason = $3, decided_at = now() where id = $1 and status = 'pending_review' returning *",
        [requestId, approverAdminId, reason || ""]
      );
      return normalizeRequest(r.rows[0]);
    },
    async unlockUser({ userId, approverAdminId, reason }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const user = (await client.query("select id, status from users where id = $1 for update", [userId])).rows[0];
        if (!user) { await client.query("rollback"); return { notFound: true }; }
        if (user.status === "normal") { await client.query("rollback"); return { alreadyNormal: true }; }
        await client.query("update users set status = 'normal', version = version + 1 where id = $1", [userId]);
        await client.query(
          `insert into account_status_history (user_id, from_status, to_status, action, actor_admin_id, reason)
           values ($1, $2, 'normal', 'unlock', $3, $4)`,
          [userId, user.status, approverAdminId || null, reason || ""]
        );
        await client.query("commit");
        return { fromStatus: user.status };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async userStatus(userId) {
      const r = await pool().query("select status from users where id = $1", [userId]);
      return r.rows[0]?.status || null;
    },
    async statusHistory(userId) {
      const r = await pool().query("select * from account_status_history where user_id = $1 order by created_at asc", [userId]);
      return r.rows.map(normalizeHistory);
    },

    // ---- V2-09-11 address blacklist ----
    async addBlacklistEntry({ fingerprint, fuzzyKey, countryCode, reason, adminId }) {
      try {
        const r = await pool().query(
          "insert into address_blacklist (fingerprint, fuzzy_key, country_code, reason, added_by_admin_id) values ($1, $2, $3, $4, $5) returning *",
          [fingerprint, fuzzyKey || "", countryCode || "", reason || "", adminId || null]
        );
        return { entry: normalizeBlacklist(r.rows[0]), created: true };
      } catch (error) {
        if (error.code === "23505") return { entry: null, created: false };
        throw error;
      }
    },
    async listBlacklist(limit = 100) {
      const r = await pool().query("select * from address_blacklist order by created_at desc limit $1", [Math.min(limit, 200)]);
      return r.rows.map(normalizeBlacklist);
    },
    async matchExact(fingerprint) {
      const r = await pool().query("select * from address_blacklist where fingerprint = $1", [fingerprint]);
      return normalizeBlacklist(r.rows[0]);
    },
    async matchFuzzy(fuzzyKey, excludeFingerprint) {
      if (!fuzzyKey) return [];
      const r = await pool().query(
        "select * from address_blacklist where fuzzy_key = $1 and fingerprint <> $2 order by created_at desc limit 20",
        [fuzzyKey, excludeFingerprint || ""]
      );
      return r.rows.map(normalizeBlacklist);
    },
    async createReviewFlag({ userId, candidate, matchKind, blacklistId }) {
      const r = await pool().query(
        "insert into address_review_flags (user_id, candidate, match_kind, blacklist_id) values ($1, $2, $3, $4) returning *",
        [userId || null, JSON.stringify(candidate || {}), matchKind, blacklistId || null]
      );
      return normalizeFlag(r.rows[0]);
    },
    async listReviewFlags({ status = "pending", limit = 50 } = {}) {
      const r = await pool().query(
        "select * from address_review_flags where ($1::text is null or status = $1) order by created_at desc limit $2",
        [status, Math.min(limit, 100)]
      );
      return r.rows.map(normalizeFlag);
    },
    async decideReviewFlag({ flagId, status }) {
      const r = await pool().query("update address_review_flags set status = $2 where id = $1 and status = 'pending' returning *", [flagId, status]);
      return normalizeFlag(r.rows[0]);
    }
  };
}

export function normalizeBlacklist(row) {
  if (!row) return null;
  return { id: row.id, fingerprint: row.fingerprint, fuzzyKey: row.fuzzy_key, countryCode: row.country_code, reason: row.reason, createdAt: row.created_at };
}
export function normalizeFlag(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, candidate: row.candidate || {}, matchKind: row.match_kind, blacklistId: row.blacklist_id, status: row.status, createdAt: row.created_at };
}

export function normalizeEvent(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, type: row.type, severity: row.severity, detail: row.detail || {}, evidenceRef: row.evidence_ref, autoRule: row.auto_rule, externalId: row.external_id, createdAt: row.created_at };
}
export function normalizeRequest(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, targetStatus: row.target_status, reason: row.reason, evidence: row.evidence || [], status: row.status, initiatedByAdminId: row.initiated_by_admin_id, approverAdminId: row.approver_admin_id, decisionReason: row.decision_reason, decidedAt: row.decided_at, createdAt: row.created_at };
}
export function normalizeHistory(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, fromStatus: row.from_status, toStatus: row.to_status, action: row.action, actorAdminId: row.actor_admin_id, reason: row.reason, createdAt: row.created_at };
}
