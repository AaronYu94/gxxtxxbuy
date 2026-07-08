import { getDbPool } from "../db/pool.js";

export function createPgAuditRepository(env) {
  return {
    async insertAuditLog(event) {
      await getDbPool(env).query(
        `insert into audit_logs (
          actor_type,
          actor_user_id,
          actor_admin_user_id,
          action,
          resource_type,
          resource_id,
          metadata,
          request_id,
          ip_hash
        ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          event.actorType,
          event.actorUserId,
          event.actorAdminUserId,
          event.action,
          event.resourceType,
          event.resourceId,
          JSON.stringify(event.metadata || {}),
          event.requestId,
          event.ipHash
        ]
      );
    }
  };
}
