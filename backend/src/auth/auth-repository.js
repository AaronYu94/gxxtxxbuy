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

    async markUserEmailVerified(userId, verifiedAt) {
      const result = await getDbPool(env).query(
        `update users set email_verified_at = coalesce(email_verified_at, $2)
         where id = $1 returning *`,
        [userId, verifiedAt]
      );
      return normalizeUser(result.rows[0]);
    },

    // ---- social login identities ----
    async findOAuthIdentity(provider, providerUserId) {
      const r = await getDbPool(env).query("select * from oauth_identities where provider = $1 and provider_user_id = $2", [provider, String(providerUserId)]);
      return r.rows[0] ? { id: r.rows[0].id, userId: r.rows[0].user_id, provider: r.rows[0].provider, providerUserId: r.rows[0].provider_user_id, email: r.rows[0].email } : null;
    },
    async linkOAuthIdentity({ userId, provider, providerUserId, email, displayName }) {
      try {
        const r = await getDbPool(env).query(
          `insert into oauth_identities (user_id, provider, provider_user_id, email, display_name)
           values ($1, $2, $3, $4, $5)
           on conflict (provider, provider_user_id) do update set email = excluded.email, display_name = excluded.display_name
           returning *`,
          [userId, provider, String(providerUserId), email || "", displayName || ""]
        );
        return { id: r.rows[0].id, userId: r.rows[0].user_id, created: true };
      } catch (error) {
        if (error.code === "23505") { const e = new Error("provider already linked to another user"); e.code = "OAUTH_PROVIDER_LINKED"; throw e; }
        throw error;
      }
    },
    async listOAuthIdentities(userId) {
      const r = await getDbPool(env).query("select provider, email, created_at from oauth_identities where user_id = $1 order by provider", [userId]);
      return r.rows.map((x) => ({ provider: x.provider, email: x.email, createdAt: x.created_at }));
    },

    async setUserSecurityLock(userId, lockedUntil) {
      const result = await getDbPool(env).query(
        "update users set security_locked_until = $2 where id = $1 returning *",
        [userId, lockedUntil]
      );
      return normalizeUser(result.rows[0]);
    },

    async createEmailVerificationToken(input) {
      const result = await getDbPool(env).query(
        `insert into email_verification_tokens
          (user_id, purpose, token_hash, device_hash, expires_at)
         values ($1, $2, $3, $4, $5) returning *`,
        [input.userId, input.purpose, input.tokenHash, input.deviceHash || null, input.expiresAt]
      );
      return normalizeEmailToken(result.rows[0]);
    },

    async findEmailVerificationToken(tokenHash) {
      const result = await getDbPool(env).query(
        "select * from email_verification_tokens where token_hash = $1 limit 1",
        [tokenHash]
      );
      return normalizeEmailToken(result.rows[0]);
    },

    async findLatestEmailVerificationToken(userId, purpose) {
      const result = await getDbPool(env).query(
        `select * from email_verification_tokens
         where user_id = $1 and purpose = $2
         order by created_at desc limit 1`,
        [userId, purpose]
      );
      return normalizeEmailToken(result.rows[0]);
    },

    async consumeEmailVerificationToken(id, usedAt) {
      const result = await getDbPool(env).query(
        `update email_verification_tokens set used_at = $2
         where id = $1 and used_at is null returning *`,
        [id, usedAt]
      );
      return normalizeEmailToken(result.rows[0]);
    },

    async findUserDevice(userId, deviceHash) {
      const result = await getDbPool(env).query(
        "select * from user_devices where user_id = $1 and device_hash = $2 limit 1",
        [userId, deviceHash]
      );
      return normalizeDevice(result.rows[0]);
    },

    async upsertUserDevice(input) {
      const result = await getDbPool(env).query(
        `insert into user_devices (user_id, device_hash, label, last_seen_at)
         values ($1, $2, $3, $4)
         on conflict (user_id, device_hash) do update
         set label = case when excluded.label = '' then user_devices.label else excluded.label end,
             last_seen_at = excluded.last_seen_at
         returning *`,
        [input.userId, input.deviceHash, input.label || "", input.lastSeenAt]
      );
      return normalizeDevice(result.rows[0]);
    },

    async trustUserDevice(userId, deviceHash, trustedAt) {
      const result = await getDbPool(env).query(
        `update user_devices set trusted_at = $3, trust_revoked_at = null, last_seen_at = $3
         where user_id = $1 and device_hash = $2 returning *`,
        [userId, deviceHash, trustedAt]
      );
      return normalizeDevice(result.rows[0]);
    },

    async revokeUserDeviceTrust(userId) {
      await getDbPool(env).query(
        "update user_devices set trust_revoked_at = now() where user_id = $1 and trust_revoked_at is null",
        [userId]
      );
    },

    async recordLoginAttempt(input) {
      await getDbPool(env).query(
        `insert into login_attempts
          (actor_type, principal_hash, ip_hash, device_hash, succeeded, failure_reason, attempted_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [input.actorType, input.principalHash, input.ipHash || null, input.deviceHash || null,
          input.succeeded, input.failureReason || null, input.attemptedAt]
      );
    },

    async countRecentFailedLogins(actorType, principalHash, since) {
      const result = await getDbPool(env).query(
        `select count(*)::integer as count from login_attempts
         where actor_type = $1 and principal_hash = $2 and succeeded = false and attempted_at >= $3`,
        [actorType, principalHash, since]
      );
      return result.rows[0]?.count || 0;
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
        `insert into admin_users (email, email_normalized, display_name, password_hash, status, employee_no, department_code, organization_code)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [input.email, input.emailNormalized, input.displayName || "", input.passwordHash, input.status || "enabled",
          input.employeeNo || null, input.departmentCode || null, input.organizationCode || null]
      );
      return normalizeAdminUser(result.rows[0]);
    },

    async markAdminLogin(id) {
      await getDbPool(env).query("update admin_users set last_login_at = now() where id = $1", [id]);
    },

    async createAdminAuthChallenge(input) {
      const result = await getDbPool(env).query(
        `insert into admin_auth_challenges
          (admin_user_id, challenge_token_hash, challenge_type, expires_at, ip_hash, device_hash)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [input.adminUserId, input.challengeTokenHash, input.challengeType, input.expiresAt,
          input.ipHash || null, input.deviceHash || null]
      );
      return normalizeAdminChallenge(result.rows[0]);
    },

    async findAdminAuthChallenge(tokenHash) {
      const result = await getDbPool(env).query(
        "select * from admin_auth_challenges where challenge_token_hash = $1 limit 1",
        [tokenHash]
      );
      return normalizeAdminChallenge(result.rows[0]);
    },

    async setAdminChallengeSecret(id, encryptedSecret) {
      const result = await getDbPool(env).query(
        `update admin_auth_challenges set pending_totp_secret_encrypted = $2
         where id = $1 and consumed_at is null returning *`,
        [id, encryptedSecret]
      );
      return normalizeAdminChallenge(result.rows[0]);
    },

    async incrementAdminChallengeAttempts(id) {
      await getDbPool(env).query(
        "update admin_auth_challenges set attempts = attempts + 1 where id = $1 and consumed_at is null",
        [id]
      );
    },

    async consumeAdminAuthChallenge(id, consumedAt) {
      const result = await getDbPool(env).query(
        `update admin_auth_challenges set consumed_at = $2
         where id = $1 and consumed_at is null returning *`,
        [id, consumedAt]
      );
      return normalizeAdminChallenge(result.rows[0]);
    },

    async enableAdminTotp(adminUserId, encryptedSecret, counter, enabledAt) {
      const result = await getDbPool(env).query(
        `update admin_users
         set totp_secret_encrypted = $2, totp_last_counter = $3, totp_enabled_at = $4
         where id = $1 returning *`,
        [adminUserId, encryptedSecret, counter, enabledAt]
      );
      return normalizeAdminUser(result.rows[0]);
    },

    async updateAdminTotpCounter(adminUserId, expectedLastCounter, counter) {
      const result = await getDbPool(env).query(
        `update admin_users set totp_last_counter = $3
         where id = $1 and totp_last_counter is not distinct from $2 returning *`,
        [adminUserId, expectedLastCounter, counter]
      );
      return Boolean(result.rowCount);
    },

    async replaceAdminRecoveryCodes(adminUserId, codeHashes) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("delete from admin_totp_recovery_codes where admin_user_id = $1", [adminUserId]);
        for (const codeHash of codeHashes) {
          await client.query(
            "insert into admin_totp_recovery_codes (admin_user_id, code_hash) values ($1, $2)",
            [adminUserId, codeHash]
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async consumeAdminRecoveryCode(adminUserId, codeHash, usedAt) {
      const result = await getDbPool(env).query(
        `update admin_totp_recovery_codes set used_at = $3
         where admin_user_id = $1 and code_hash = $2 and used_at is null returning id`,
        [adminUserId, codeHash, usedAt]
      );
      return Boolean(result.rowCount);
    },

    async createAdminReauthChallenge(input) {
      const result = await getDbPool(env).query(
        `insert into admin_reauth_challenges
          (admin_user_id, session_id, challenge_token_hash, action, reason, resource_type, resource_id, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [input.adminUserId, input.sessionId, input.challengeTokenHash, input.action, input.reason,
          input.resourceType || null, input.resourceId || null, input.expiresAt]
      );
      return normalizeReauthChallenge(result.rows[0]);
    },

    async findAdminReauthChallenge(tokenHash) {
      const result = await getDbPool(env).query(
        "select * from admin_reauth_challenges where challenge_token_hash = $1 limit 1",
        [tokenHash]
      );
      return normalizeReauthChallenge(result.rows[0]);
    },

    async consumeAdminReauthChallenge(id, consumedAt) {
      const result = await getDbPool(env).query(
        `update admin_reauth_challenges set consumed_at = $2
         where id = $1 and consumed_at is null returning *`,
        [id, consumedAt]
      );
      return normalizeReauthChallenge(result.rows[0]);
    },

    async revokeActorSessions(actorType, actorId) {
      const ownerColumn = actorType === "admin" ? "admin_user_id" : "user_id";
      await getDbPool(env).query(
        `update sessions set revoked_at = now() where actor_type = $1 and ${ownerColumn} = $2 and revoked_at is null`,
        [actorType, actorId]
      );
    },

    async disableAdminUser(adminUserId) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          "update admin_users set status = 'disabled' where id = $1 returning *",
          [adminUserId]
        );
        await client.query(
          "update sessions set revoked_at = now() where actor_type = 'admin' and admin_user_id = $1 and revoked_at is null",
          [adminUserId]
        );
        await client.query("commit");
        return normalizeAdminUser(result.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async assignAdminRole(adminUserId, roleCode, grantedByAdminId) {
      const result = await getDbPool(env).query(
        `insert into admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
         select $1, id, $3 from roles where code = $2
         on conflict (admin_user_id) do nothing returning role_id`,
        [adminUserId, roleCode, grantedByAdminId || null]
      );
      return Boolean(result.rowCount);
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
          ip_hash,
          device_hash,
          authenticated_at,
          absolute_expires_at,
          mfa_verified_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          input.ipHash || "",
          input.deviceHash || null,
          input.authenticatedAt || null,
          input.absoluteExpiresAt || null,
          input.mfaVerifiedAt || null
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
    phone: row.phone ?? null,
    phoneVerifiedAt: toIso(row.phone_verified_at ?? row.phoneVerifiedAt),
    countryCode: row.country_code ?? row.countryCode ?? null,
    defaultLocale: row.default_locale ?? row.defaultLocale ?? "en-US",
    defaultCurrency: row.default_currency ?? row.defaultCurrency ?? "USD",
    version: Number(row.version ?? 1),
    deletionRequestedAt: toIso(row.deletion_requested_at ?? row.deletionRequestedAt),
    emailVerifiedAt: toIso(row.email_verified_at ?? row.emailVerifiedAt),
    securityLockedUntil: toIso(row.security_locked_until ?? row.securityLockedUntil),
    anonymizedAt: toIso(row.anonymized_at ?? row.anonymizedAt),
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
    employeeNo: row.employee_no ?? row.employeeNo ?? null,
    departmentCode: row.department_code ?? row.departmentCode ?? null,
    organizationCode: row.organization_code ?? row.organizationCode ?? null,
    totpSecretEncrypted: row.totp_secret_encrypted ?? row.totpSecretEncrypted ?? null,
    totpEnabledAt: toIso(row.totp_enabled_at ?? row.totpEnabledAt),
    totpLastCounter: row.totp_last_counter === null || row.totp_last_counter === undefined
      ? (row.totpLastCounter ?? null)
      : Number(row.totp_last_counter),
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
    deviceHash: row.device_hash ?? row.deviceHash ?? "",
    authenticatedAt: toIso(row.authenticated_at ?? row.authenticatedAt),
    absoluteExpiresAt: toIso(row.absolute_expires_at ?? row.absoluteExpiresAt),
    mfaVerifiedAt: toIso(row.mfa_verified_at ?? row.mfaVerifiedAt),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    lastUsedAt: toIso(row.last_used_at ?? row.lastUsedAt)
  };
}

function normalizeEmailToken(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    purpose: row.purpose,
    tokenHash: row.token_hash ?? row.tokenHash,
    deviceHash: row.device_hash ?? row.deviceHash ?? "",
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    usedAt: toIso(row.used_at ?? row.usedAt),
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

function normalizeDevice(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    deviceHash: row.device_hash ?? row.deviceHash,
    label: row.label || "",
    trustedAt: toIso(row.trusted_at ?? row.trustedAt),
    trustRevokedAt: toIso(row.trust_revoked_at ?? row.trustRevokedAt),
    lastSeenAt: toIso(row.last_seen_at ?? row.lastSeenAt),
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

function normalizeAdminChallenge(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    adminUserId: String(row.admin_user_id ?? row.adminUserId),
    challengeTokenHash: row.challenge_token_hash ?? row.challengeTokenHash,
    challengeType: row.challenge_type ?? row.challengeType,
    pendingTotpSecretEncrypted: row.pending_totp_secret_encrypted ?? row.pendingTotpSecretEncrypted ?? null,
    attempts: Number(row.attempts || 0),
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    consumedAt: toIso(row.consumed_at ?? row.consumedAt),
    ipHash: row.ip_hash ?? row.ipHash ?? "",
    deviceHash: row.device_hash ?? row.deviceHash ?? "",
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

function normalizeReauthChallenge(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    adminUserId: String(row.admin_user_id ?? row.adminUserId),
    sessionId: String(row.session_id ?? row.sessionId),
    challengeTokenHash: row.challenge_token_hash ?? row.challengeTokenHash,
    action: row.action,
    reason: row.reason,
    resourceType: row.resource_type ?? row.resourceType ?? null,
    resourceId: row.resource_id ?? row.resourceId ?? null,
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    consumedAt: toIso(row.consumed_at ?? row.consumedAt),
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

function toIso(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}
