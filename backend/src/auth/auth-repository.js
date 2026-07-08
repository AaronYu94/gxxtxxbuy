import { getDbPool } from "../db/pool.js";

export function createPgAuthRepository(env) {
  return {
    async findUserByEmail(emailNormalized) {
      const result = await getDbPool(env).query(
        `select * from users
         where email_normalized = $1 and deleted_at is null
         limit 1`,
        [emailNormalized]
      );
      return normalizeUser(result.rows[0]);
    },

    async findUserById(id) {
      const result = await getDbPool(env).query(
        `select * from users
         where id = $1 and deleted_at is null
         limit 1`,
        [id]
      );
      return normalizeUser(result.rows[0]);
    },

    async createUser(input) {
      const result = await getDbPool(env).query(
        `insert into users (email, email_normalized, display_name, password_hash)
         values ($1, $2, $3, $4)
         returning *`,
        [input.email, input.emailNormalized, input.displayName || "", input.passwordHash]
      );
      return normalizeUser(result.rows[0]);
    },

    async findAdminByEmail(emailNormalized) {
      const result = await getDbPool(env).query(
        `select * from admin_users
         where email_normalized = $1 and deleted_at is null
         limit 1`,
        [emailNormalized]
      );
      return normalizeAdminUser(result.rows[0]);
    },

    async findAdminById(id) {
      const result = await getDbPool(env).query(
        `select * from admin_users
         where id = $1 and deleted_at is null
         limit 1`,
        [id]
      );
      return normalizeAdminUser(result.rows[0]);
    },

    async createAdminUser(input) {
      const result = await getDbPool(env).query(
        `insert into admin_users (email, email_normalized, display_name, password_hash, status)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [input.email, input.emailNormalized, input.displayName || "", input.passwordHash, input.status || "active"]
      );
      return normalizeAdminUser(result.rows[0]);
    },

    async markAdminLogin(id) {
      await getDbPool(env).query("update admin_users set last_login_at = now() where id = $1", [id]);
    },

    async createSession(input) {
      const result = await getDbPool(env).query(
        `insert into sessions (
          actor_type,
          user_id,
          admin_user_id,
          access_token_hash,
          refresh_token_hash,
          expires_at,
          refresh_expires_at,
          user_agent,
          ip_hash
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *`,
        [
          input.actorType,
          input.userId || null,
          input.adminUserId || null,
          input.accessTokenHash,
          input.refreshTokenHash,
          input.expiresAt,
          input.refreshExpiresAt,
          input.userAgent || "",
          input.ipHash || ""
        ]
      );
      return normalizeSession(result.rows[0]);
    },

    async findSessionByAccessTokenHash(accessTokenHash, actorType) {
      const result = await getDbPool(env).query(
        `select * from sessions
         where access_token_hash = $1 and actor_type = $2
         limit 1`,
        [accessTokenHash, actorType]
      );
      return normalizeSession(result.rows[0]);
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, actorType) {
      const result = await getDbPool(env).query(
        `select * from sessions
         where refresh_token_hash = $1 and actor_type = $2
         limit 1`,
        [refreshTokenHash, actorType]
      );
      return normalizeSession(result.rows[0]);
    },

    async rotateSession(sessionId, input) {
      const result = await getDbPool(env).query(
        `update sessions
         set access_token_hash = $2,
             refresh_token_hash = $3,
             expires_at = $4,
             refresh_expires_at = $5,
             revoked_at = null,
             last_used_at = now()
         where id = $1
         returning *`,
        [sessionId, input.accessTokenHash, input.refreshTokenHash, input.expiresAt, input.refreshExpiresAt]
      );
      return normalizeSession(result.rows[0]);
    },

    async revokeSession(sessionId) {
      await getDbPool(env).query("update sessions set revoked_at = now() where id = $1", [sessionId]);
    },

    async getAdminAccess(adminUserId) {
      const result = await getDbPool(env).query(
        `select roles.code as role_code, permissions.code as permission_code
         from admin_user_roles
         join roles on roles.id = admin_user_roles.role_id
         join role_permissions on role_permissions.role_id = roles.id
         join permissions on permissions.code = role_permissions.permission_code
         where admin_user_roles.admin_user_id = $1
         order by roles.code, permissions.code`,
        [adminUserId]
      );

      const roles = Array.from(new Set(result.rows.map((row) => row.role_code)));
      const permissions = Array.from(new Set(result.rows.map((row) => row.permission_code)));
      return { roles, permissions };
    }
  };
}

export function normalizeUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    email: row.email,
    emailNormalized: row.email_normalized ?? row.emailNormalized,
    displayName: row.display_name ?? row.displayName ?? "",
    passwordHash: row.password_hash ?? row.passwordHash,
    status: row.status,
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    deletedAt: toIso(row.deleted_at ?? row.deletedAt)
  };
}

export function normalizeAdminUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    email: row.email,
    emailNormalized: row.email_normalized ?? row.emailNormalized,
    displayName: row.display_name ?? row.displayName ?? "",
    passwordHash: row.password_hash ?? row.passwordHash,
    status: row.status,
    lastLoginAt: toIso(row.last_login_at ?? row.lastLoginAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    deletedAt: toIso(row.deleted_at ?? row.deletedAt)
  };
}

export function normalizeSession(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    actorType: row.actor_type ?? row.actorType,
    userId: row.user_id ? String(row.user_id) : row.userId || null,
    adminUserId: row.admin_user_id ? String(row.admin_user_id) : row.adminUserId || null,
    accessTokenHash: row.access_token_hash ?? row.accessTokenHash,
    refreshTokenHash: row.refresh_token_hash ?? row.refreshTokenHash,
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    refreshExpiresAt: toIso(row.refresh_expires_at ?? row.refreshExpiresAt),
    revokedAt: toIso(row.revoked_at ?? row.revokedAt),
    ipHash: row.ip_hash ?? row.ipHash ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    lastUsedAt: toIso(row.last_used_at ?? row.lastUsedAt)
  };
}

function toIso(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}
