import { getDbPool } from "../db/pool.js";

export function createPgRiskRepository(env) {
  return {
    async createCase(input) {
      const result = await getDbPool(env).query(
        `insert into risk_cases (
          risk_type, status, severity, subject_user_id, subject_ref, reason,
          owner_admin_user_id, metadata, source, created_by_admin_user_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *`,
        [
          input.riskType,
          input.status || "open",
          input.severity || "medium",
          input.subjectUserId || null,
          input.subjectRef || "",
          input.reason || "",
          input.ownerAdminUserId || null,
          input.metadata || {},
          input.source || "manual",
          input.createdByAdminUserId || null
        ]
      );
      return normalizeRiskCase(result.rows[0]);
    },

    // Idempotent open-case creation for automated sources. Returns the existing active
    // case when one already matches (source, risk_type, subject_ref).
    async createAutoCaseIfAbsent(input) {
      const result = await getDbPool(env).query(
        `insert into risk_cases (risk_type, status, severity, subject_user_id, subject_ref, reason, metadata, source)
         values ($1, 'open', $2, $3, $4, $5, $6, $7)
         on conflict do nothing
         returning *`,
        [input.riskType, input.severity || "medium", input.subjectUserId || null, input.subjectRef || "", input.reason || "", input.metadata || {}, input.source]
      );
      if (result.rows[0]) return { case: normalizeRiskCase(result.rows[0]), created: true };
      const existing = await getDbPool(env).query(
        `select * from risk_cases
         where source = $1 and risk_type = $2 and subject_ref = $3 and status in ('open', 'investigating')
         limit 1`,
        [input.source, input.riskType, input.subjectRef || ""]
      );
      return { case: normalizeRiskCase(existing.rows[0]), created: false };
    },

    async findCaseById(id) {
      const result = await getDbPool(env).query("select * from risk_cases where id = $1 limit 1", [id]);
      return normalizeRiskCase(result.rows[0]);
    },

    async listCases({ status = "", limit = 25, offset = 0 } = {}) {
      const pool = getDbPool(env);
      const [rows, count] = await Promise.all([
        pool.query(
          `select * from risk_cases
           where ($1 = '' or status = $1)
           order by created_at desc limit $2 offset $3`,
          [status, limit, offset]
        ),
        pool.query("select count(*)::int as total from risk_cases where ($1 = '' or status = $1)", [status])
      ]);
      return { cases: rows.rows.map(normalizeRiskCase), total: count.rows[0].total };
    },

    async updateCase(id, patch) {
      const result = await getDbPool(env).query(
        `update risk_cases
         set status = coalesce($2, status),
             severity = coalesce($3, severity),
             reason = coalesce($4, reason),
             owner_admin_user_id = coalesce($5, owner_admin_user_id),
             resolved_at = case when $2 in ('resolved', 'dismissed') then now() else resolved_at end
         where id = $1
         returning *`,
        [id, patch.status || null, patch.severity || null, patch.reason || null, patch.ownerAdminUserId || null]
      );
      return normalizeRiskCase(result.rows[0]);
    }
  };
}

export function normalizeRiskCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    riskType: row.risk_type ?? row.riskType,
    status: row.status,
    severity: row.severity,
    subjectUserId: row.subject_user_id ?? row.subjectUserId ?? null,
    subjectRef: row.subject_ref ?? row.subjectRef ?? "",
    reason: row.reason ?? "",
    ownerAdminUserId: row.owner_admin_user_id ?? row.ownerAdminUserId ?? null,
    metadata: row.metadata ?? {},
    source: row.source ?? "manual",
    createdByAdminUserId: row.created_by_admin_user_id ?? row.createdByAdminUserId ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    resolvedAt: row.resolved_at ?? row.resolvedAt ?? null
  };
}
