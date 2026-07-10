import { randomUUID } from "node:crypto";
import { badRequest, conflict, forbidden, notFound, tooManyRequests, unauthorized } from "../errors/app-error.js";
import { hashDeviceFingerprint, hashPrincipal } from "../security/device.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { createOpaqueToken, hashIp, hashToken } from "../security/token.js";
import {
  createOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode
} from "../security/totp.js";
import { requireEmail, optionalDisplayName, requirePassword, requireToken } from "./input.js";
import { createSessionPayload, toSessionResponse } from "./session.js";

const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const DEFAULTS = Object.freeze({
  authVerificationTtlSeconds: 1800,
  authVerificationResendSeconds: 60,
  authDeviceReverifyDays: 7,
  authLoginFailureLimit: 5,
  authLoginFailureWindowSeconds: 900,
  authSecurityLockSeconds: 86400,
  authDeviceHmacSecret: "local-dev-device-hmac-secret",
  authTotpEncryptionSecret: "local-dev-totp-encryption-secret",
  authTotpIssuer: "GoatedBuy",
  authAdminChallengeTtlSeconds: 300,
  authReauthTtlSeconds: 300,
  authAdminAbsoluteSessionHours: 24,
  authExposeVerificationToken: true
});

export function createAuthService({ repository, auditLogger, env = {}, notifier, clock = () => new Date() }) {
  if (!repository) throw new Error("Auth repository is required.");
  const config = { ...DEFAULTS, ...env };

  async function issueEmailToken(user, purpose, requestMeta = {}) {
    const now = clock();
    const latest = await repository.findLatestEmailVerificationToken?.(user.id, purpose);
    if (latest && now.getTime() - new Date(latest.createdAt).getTime() < config.authVerificationResendSeconds * 1000) {
      throw tooManyRequests("Please wait before requesting another verification email.");
    }
    const token = createOpaqueToken(32);
    const deviceHash = getDeviceHash(requestMeta, config);
    await repository.createEmailVerificationToken({
      userId: user.id,
      purpose,
      tokenHash: hashToken(token),
      deviceHash,
      expiresAt: addSeconds(now, config.authVerificationTtlSeconds)
    });
    await notifier?.sendEmailVerification?.({ email: user.email, token, purpose });
    return token;
  }

  async function verifyEmailToken(input, expectedPurpose, requestMeta = {}) {
    const token = requireToken(input?.token, "token");
    const record = await repository.findEmailVerificationToken(hashToken(token));
    if (!record || record.purpose !== expectedPurpose) throw badRequest("Verification token is invalid.");
    const user = await repository.findUserById(record.userId);
    if (record.usedAt) {
      if (expectedPurpose === "registration" && user?.emailVerifiedAt) {
        return { user, record, idempotent: true };
      }
      throw conflict("Verification token has already been used.");
    }
    if (new Date(record.expiresAt).getTime() <= clock().getTime()) throw badRequest("Verification token has expired.");
    const requestDeviceHash = getDeviceHash(requestMeta, config);
    if (record.deviceHash && requestDeviceHash && record.deviceHash !== requestDeviceHash) {
      throw forbidden("Verification must be completed on the requesting device.");
    }
    const consumed = await repository.consumeEmailVerificationToken(record.id, clock().toISOString());
    if (!consumed) throw conflict("Verification token has already been used.");
    return { user, record, idempotent: false };
  }

  async function recordLogin(actorType, emailNormalized, requestMeta, succeeded, failureReason) {
    await repository.recordLoginAttempt?.({
      actorType,
      principalHash: hashPrincipal(emailNormalized),
      ipHash: hashIp(requestMeta.ip),
      deviceHash: getDeviceHash(requestMeta, config),
      succeeded,
      failureReason,
      attemptedAt: clock().toISOString()
    });
  }

  return {
    async registerUser(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = requirePassword(input?.password);
      const displayName = optionalDisplayName(input?.display_name ?? input?.displayName);
      const existing = await repository.findUserByEmail(emailNormalized);
      if (existing && !existing.deletedAt) throw conflict("Email already registered.");

      const user = await createUserSafely(repository, {
        email: String(input.email).trim(), emailNormalized, displayName, passwordHash: await hashPassword(password)
      });
      const token = await issueEmailToken(user, "registration", requestMeta);
      await auditLogger?.write({
        actorType: "user", actorUserId: user.id, action: "auth.register", resourceType: "user", resourceId: user.id,
        metadata: { email: user.email, verification_token: token }, requestId: requestMeta.requestId, ipHash: hashIp(requestMeta.ip)
      }, { critical: false });
      return {
        user: publicUser(user),
        verification_required: true,
        ...(config.authExposeVerificationToken ? { verification_token: token } : {})
      };
    },

    async resendRegistrationVerification(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const user = await repository.findUserByEmail(emailNormalized);
      if (!user) return { accepted: true };
      if (user.emailVerifiedAt) return { accepted: true, verification_required: false };
      const token = await issueEmailToken(user, "registration", requestMeta);
      return { accepted: true, verification_required: true, ...(config.authExposeVerificationToken ? { verification_token: token } : {}) };
    },

    async verifyRegistrationEmail(input, requestMeta = {}) {
      const verified = await verifyEmailToken(input, "registration", requestMeta);
      const user = verified.idempotent
        ? verified.user
        : await repository.markUserEmailVerified(verified.user.id, clock().toISOString());
      const deviceHash = verified.record.deviceHash || getDeviceHash(requestMeta, config);
      if (deviceHash) {
        await repository.upsertUserDevice({ userId: user.id, deviceHash, label: input?.device_label, lastSeenAt: clock().toISOString() });
        await repository.trustUserDevice(user.id, deviceHash, clock().toISOString());
      }
      return { user: publicUser(user), verified: true, idempotent: verified.idempotent };
    },

    async loginUser(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = String(input?.password || "");
      const user = await repository.findUserByEmail(emailNormalized);
      const validPassword = user ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !validPassword) {
        await recordLogin("user", emailNormalized, requestMeta, false, "invalid_credentials");
        if (user) await maybeLockUser(repository, user, emailNormalized, config, clock());
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }
      if (user.deletionRequestedAt) throw forbidden("Account deletion is already pending.");
      if (user.status === "risk_locked") throw forbidden("Account is locked by risk control.");
      if (user.status !== "normal") throw forbidden("Account is not available.");
      if (user.securityLockedUntil && new Date(user.securityLockedUntil).getTime() > clock().getTime()) {
        throw tooManyRequests("Account is temporarily locked for security review.");
      }
      if (!user.emailVerifiedAt) throw forbidden("Email verification is required.");

      const deviceHash = getDeviceHash(requestMeta, config);
      const device = deviceHash ? await repository.findUserDevice(user.id, deviceHash) : null;
      const reverifyCutoff = clock().getTime() - config.authDeviceReverifyDays * 86400000;
      const trusted = device?.trustedAt && !device.trustRevokedAt && new Date(device.trustedAt).getTime() > reverifyCutoff;
      if (!trusted) {
        if (deviceHash) await repository.upsertUserDevice({ userId: user.id, deviceHash, label: input?.device_label, lastSeenAt: clock().toISOString() });
        const token = await issueEmailToken(user, "device_reverify", requestMeta);
        await recordLogin("user", emailNormalized, requestMeta, true, "device_reverify_required");
        return {
          user: publicUser(user), device_verification_required: true,
          ...(config.authExposeVerificationToken ? { verification_token: token } : {})
        };
      }
      await recordLogin("user", emailNormalized, requestMeta, true);
      const sessionResult = await createActorSession(repository, "user", user, secureMeta(requestMeta, config), clock(), config);
      return { user: publicUser(user), session: toSessionResponse(sessionResult.tokens, sessionResult.session) };
    },

    async verifyLoginDevice(input, requestMeta = {}) {
      const verified = await verifyEmailToken(input, "device_reverify", requestMeta);
      const deviceHash = verified.record.deviceHash || getDeviceHash(requestMeta, config);
      if (!deviceHash) throw badRequest("A device identifier is required.");
      await repository.upsertUserDevice({ userId: verified.user.id, deviceHash, label: input?.device_label, lastSeenAt: clock().toISOString() });
      await repository.trustUserDevice(verified.user.id, deviceHash, clock().toISOString());
      const sessionResult = await createActorSession(repository, "user", verified.user, { ...secureMeta(requestMeta, config), deviceHash }, clock(), config);
      return { user: publicUser(verified.user), session: toSessionResponse(sessionResult.tokens, sessionResult.session) };
    },

    async refreshUserSession(input, requestMeta = {}) {
      return refreshActorSession(repository, "user", input, secureMeta(requestMeta, config), clock(), config);
    },

    async authenticateUser(accessToken) {
      const session = await requireActiveAccessSession(repository, "user", accessToken, clock());
      const user = await repository.findUserById(session.userId);
      if (!user || user.status !== "normal" || !user.emailVerifiedAt || user.deletionRequestedAt) throw unauthorized("User session is no longer valid.");
      return { user: publicUser(user), session };
    },

    async loginAdmin(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = String(input?.password || "");
      const adminUser = await repository.findAdminByEmail(emailNormalized);
      const recentFailures = await repository.countRecentFailedLogins?.(
        "admin", hashPrincipal(emailNormalized), addSeconds(clock(), -config.authLoginFailureWindowSeconds)
      ) || 0;
      if (recentFailures >= config.authLoginFailureLimit) throw tooManyRequests("Too many login attempts. Try again later.");
      if (!adminUser || adminUser.status !== "enabled" || !(await verifyPassword(password, adminUser.passwordHash))) {
        await recordLogin("admin", emailNormalized, requestMeta, false, "invalid_credentials");
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }
      const challengeToken = createOpaqueToken(32);
      const challengeType = adminUser.totpEnabledAt ? "login" : "totp_setup";
      await repository.createAdminAuthChallenge({
        adminUserId: adminUser.id,
        challengeTokenHash: hashToken(challengeToken),
        challengeType,
        expiresAt: addSeconds(clock(), config.authAdminChallengeTtlSeconds),
        ipHash: hashIp(requestMeta.ip),
        deviceHash: getDeviceHash(requestMeta, config)
      });
      await recordLogin("admin", emailNormalized, requestMeta, true, "mfa_required");
      return { mfa_required: true, setup_required: challengeType === "totp_setup", challenge_token: challengeToken };
    },

    async beginAdminTotpSetup(input) {
      const { challenge } = await requireAdminChallenge(repository, input?.challenge_token, "totp_setup", clock());
      const adminUser = await repository.findAdminById(challenge.adminUserId);
      if (!adminUser || adminUser.status !== "enabled") throw unauthorized("Admin challenge is no longer valid.");
      let secret;
      if (challenge.pendingTotpSecretEncrypted) {
        secret = decryptTotpSecret(challenge.pendingTotpSecretEncrypted, config.authTotpEncryptionSecret);
      } else {
        secret = generateTotpSecret();
        await repository.setAdminChallengeSecret(challenge.id, encryptTotpSecret(secret, config.authTotpEncryptionSecret));
      }
      return { secret, otpauth_uri: createOtpAuthUri({ secret, account: adminUser.email, issuer: config.authTotpIssuer }) };
    },

    async confirmAdminTotpSetup(input, requestMeta = {}) {
      const { challenge } = await requireAdminChallenge(repository, input?.challenge_token, "totp_setup", clock());
      if (!challenge.pendingTotpSecretEncrypted) throw badRequest("TOTP setup has not been started.");
      const secret = decryptTotpSecret(challenge.pendingTotpSecretEncrypted, config.authTotpEncryptionSecret);
      const verification = verifyTotpCode({ secret, code: input?.code, now: clock() });
      if (!verification.valid) {
        await repository.incrementAdminChallengeAttempts(challenge.id);
        throw unauthorized("Invalid authentication code.");
      }
      await auditLogger?.write({
        actorType: "admin", actorAdminUserId: challenge.adminUserId, action: "admin.auth.totp.enable",
        resourceType: "admin_user", resourceId: challenge.adminUserId,
        metadata: { totp_code: input?.code }, requestId: requestMeta.requestId, ipHash: hashIp(requestMeta.ip)
      }, { critical: true });
      const consumed = await repository.consumeAdminAuthChallenge(challenge.id, clock().toISOString());
      if (!consumed) throw conflict("Authentication challenge has already been used.");
      const adminUser = await repository.enableAdminTotp(
        challenge.adminUserId, challenge.pendingTotpSecretEncrypted, verification.counter, clock().toISOString()
      );
      const recoveryCodes = createRecoveryCodes();
      await repository.replaceAdminRecoveryCodes(adminUser.id, recoveryCodes.map(hashToken));
      const login = await completeAdminSession(repository, adminUser, requestMeta, clock(), config);
      return { ...login, recovery_codes: recoveryCodes };
    },

    async completeAdminLogin(input, requestMeta = {}) {
      const { challenge } = await requireAdminChallenge(repository, input?.challenge_token, "login", clock());
      const adminUser = await repository.findAdminById(challenge.adminUserId);
      if (!adminUser || adminUser.status !== "enabled" || !adminUser.totpSecretEncrypted) throw unauthorized("Admin challenge is no longer valid.");
      const verified = await verifyAdminSecondFactor(repository, adminUser, input, config, clock());
      if (!verified) {
        await repository.incrementAdminChallengeAttempts(challenge.id);
        throw unauthorized("Invalid authentication code.");
      }
      await auditLogger?.write({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "admin.auth.login",
        resourceType: "admin_user", resourceId: adminUser.id,
        metadata: { method: input?.recovery_code ? "recovery_code" : "totp", recovery_code: input?.recovery_code },
        requestId: requestMeta.requestId, ipHash: hashIp(requestMeta.ip)
      }, { critical: true });
      const consumed = await repository.consumeAdminAuthChallenge(challenge.id, clock().toISOString());
      if (!consumed) throw conflict("Authentication challenge has already been used.");
      return completeAdminSession(repository, await repository.findAdminById(adminUser.id), requestMeta, clock(), config);
    },

    async createAdminReauth(adminAuth, input, requestMeta = {}) {
      const action = requireText(input?.action, "action", 100);
      const reason = requireText(input?.reason, "reason", 500);
      const adminUser = await repository.findAdminById(adminAuth.adminUser.id);
      if (!(await verifyAdminSecondFactor(repository, adminUser, input, config, clock()))) throw unauthorized("Invalid authentication code.");
      const token = createOpaqueToken(32);
      await auditLogger?.write({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "admin.reauth.create",
        resourceType: input?.resource_type || "admin_action", resourceId: input?.resource_id || null,
        metadata: { target_action: action, reason, reauth_token: token }, requestId: requestMeta.requestId, ipHash: hashIp(requestMeta.ip)
      }, { critical: true });
      await repository.createAdminReauthChallenge({
        adminUserId: adminUser.id, sessionId: adminAuth.session.id, challengeTokenHash: hashToken(token),
        action, reason, resourceType: input?.resource_type, resourceId: input?.resource_id,
        expiresAt: addSeconds(clock(), config.authReauthTtlSeconds)
      });
      return { reauth_token: token, expires_at: addSeconds(clock(), config.authReauthTtlSeconds) };
    },

    async consumeAdminReauth(token, adminAuth, action) {
      const challenge = await repository.findAdminReauthChallenge(hashToken(requireToken(token, "reauth_token")));
      if (!challenge || challenge.consumedAt || challenge.adminUserId !== adminAuth.adminUser.id
        || challenge.sessionId !== adminAuth.session.id || challenge.action !== action
        || new Date(challenge.expiresAt).getTime() <= clock().getTime()) {
        throw forbidden("Fresh re-authentication is required for this operation.");
      }
      const consumed = await repository.consumeAdminReauthChallenge(challenge.id, clock().toISOString());
      if (!consumed) throw conflict("Re-authentication challenge has already been used.");
      return challenge;
    },

    async disableAdmin(adminAuth, adminUserId, requestMeta = {}) {
      await auditLogger?.write({
        actorType: "admin", actorAdminUserId: adminAuth.adminUser.id, action: "admin.user.disable.requested",
        resourceType: "admin_user", resourceId: adminUserId, metadata: {}, requestId: requestMeta.requestId
      }, { critical: true });
      const disabled = await repository.disableAdminUser(adminUserId);
      if (!disabled) throw notFound("Admin user not found.");
      return publicAdminUser(disabled);
    },

    async assignAdminRole(adminAuth, adminUserId, roleCode, requestMeta = {}) {
      await auditLogger?.write({
        actorType: "admin", actorAdminUserId: adminAuth.adminUser.id, action: "admin.role.assign.requested",
        resourceType: "admin_user", resourceId: adminUserId, metadata: { role_code: roleCode }, requestId: requestMeta.requestId
      }, { critical: true });
      const assigned = await repository.assignAdminRole(adminUserId, roleCode, adminAuth.adminUser.id);
      if (!assigned) throw conflict("Admin user already has a role or the role does not exist.");
      await repository.revokeActorSessions("admin", adminUserId);
      return { admin_user_id: adminUserId, role_code: roleCode };
    },

    async refreshAdminSession(input, requestMeta = {}) {
      return refreshActorSession(repository, "admin", input, secureMeta(requestMeta, config), clock(), config);
    },

    async authenticateAdmin(accessToken) {
      const session = await requireActiveAccessSession(repository, "admin", accessToken, clock());
      const adminUser = await repository.findAdminById(session.adminUserId);
      if (!adminUser || adminUser.status !== "enabled" || !session.mfaVerifiedAt) throw unauthorized("Admin session is no longer valid.");
      const access = await repository.getAdminAccess(adminUser.id);
      if (access.roles.length !== 1) throw unauthorized("Admin account must have exactly one role.");
      return { adminUser: publicAdminUser(adminUser), roles: access.roles, permissions: access.permissions, session };
    },

    async revokeSession(sessionId) { await repository.revokeSession(sessionId); },
    async invalidateUserTrust(userId) {
      await repository.revokeUserDeviceTrust(userId);
      await repository.revokeActorSessions("user", userId);
    }
  };
}

export function publicUser(user) {
  return {
    id: user.id, email: user.email, display_name: user.displayName || "", status: user.status,
    email_verified: Boolean(user.emailVerifiedAt), phone: user.phone, phone_verified: Boolean(user.phoneVerifiedAt),
    country_code: user.countryCode, default_locale: user.defaultLocale || "en-US",
    default_currency: user.defaultCurrency || "USD", version: Number(user.version || 1),
    deletion_requested_at: user.deletionRequestedAt, created_at: user.createdAt
  };
}

export function publicAdminUser(adminUser) {
  return {
    id: adminUser.id, email: adminUser.email, display_name: adminUser.displayName || "", status: adminUser.status,
    employee_no: adminUser.employeeNo, department_code: adminUser.departmentCode,
    organization_code: adminUser.organizationCode, totp_enabled: Boolean(adminUser.totpEnabledAt),
    last_login_at: adminUser.lastLoginAt, created_at: adminUser.createdAt
  };
}

async function createUserSafely(repository, input) {
  try { return await repository.createUser(input); }
  catch (error) {
    if (error.code === "23505" || error.code === "DUPLICATE_EMAIL") throw conflict("Email already registered.");
    throw error;
  }
}

async function maybeLockUser(repository, user, emailNormalized, config, now) {
  const count = await repository.countRecentFailedLogins?.(
    "user", hashPrincipal(emailNormalized), addSeconds(now, -config.authLoginFailureWindowSeconds)
  ) || 0;
  if (count >= config.authLoginFailureLimit) {
    await repository.setUserSecurityLock(user.id, addSeconds(now, config.authSecurityLockSeconds));
  }
}

async function completeAdminSession(repository, adminUser, requestMeta, now, config) {
  const access = await repository.getAdminAccess(adminUser.id);
  if (access.roles.length !== 1) throw unauthorized("Admin account must have exactly one role.");
  const sessionResult = await createActorSession(repository, "admin", adminUser, secureMeta(requestMeta, config), now, config, true);
  await repository.markAdminLogin?.(adminUser.id);
  return {
    admin_user: publicAdminUser(adminUser), roles: access.roles, permissions: access.permissions,
    session: toSessionResponse(sessionResult.tokens, sessionResult.session)
  };
}

async function createActorSession(repository, actorType, principal, requestMeta, now, config, mfaVerified = false) {
  const absoluteExpiresAt = actorType === "admin"
    ? addSeconds(now, config.authAdminAbsoluteSessionHours * 3600)
    : undefined;
  const tokens = createSessionPayload(actorType, requestMeta, now, {
    absoluteExpiresAt,
    mfaVerifiedAt: mfaVerified ? now.toISOString() : null
  });
  const session = await repository.createSession({
    actorType, userId: actorType === "user" ? principal.id : null,
    adminUserId: actorType === "admin" ? principal.id : null, ...tokens
  });
  return { tokens, session };
}

async function refreshActorSession(repository, actorType, input, requestMeta, now, config) {
  const refreshToken = requireToken(input?.refresh_token ?? input?.refreshToken, "refresh_token");
  const session = await repository.findSessionByRefreshTokenHash(hashToken(refreshToken), actorType);
  ensureRefreshSession(session, now);
  const principal = actorType === "admin"
    ? await repository.findAdminById(session.adminUserId) : await repository.findUserById(session.userId);
  const validStatus = actorType === "admin" ? "enabled" : "normal";
  if (!principal || principal.status !== validStatus || (actorType === "admin" && !session.mfaVerifiedAt)) {
    throw unauthorized("Session is no longer valid.");
  }
  const tokens = createSessionPayload(actorType, requestMeta, now, {
    absoluteExpiresAt: session.absoluteExpiresAt,
    authenticatedAt: session.authenticatedAt,
    mfaVerifiedAt: session.mfaVerifiedAt
  });
  const rotated = await repository.rotateSession(session.id, tokens);
  const access = actorType === "admin" ? await repository.getAdminAccess(principal.id) : null;
  return {
    ...(actorType === "admin"
      ? { admin_user: publicAdminUser(principal), roles: access.roles, permissions: access.permissions }
      : { user: publicUser(principal) }),
    session: toSessionResponse(tokens, rotated)
  };
}

async function requireActiveAccessSession(repository, actorType, accessToken, now) {
  const token = requireToken(accessToken, "access_token");
  const session = await repository.findSessionByAccessTokenHash(hashToken(token), actorType);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= now.getTime()
    || (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt).getTime() <= now.getTime())) {
    throw unauthorized("Session is invalid or expired.");
  }
  return session;
}

function ensureRefreshSession(session, now) {
  if (!session || session.revokedAt || new Date(session.refreshExpiresAt).getTime() <= now.getTime()
    || (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt).getTime() <= now.getTime())) {
    throw unauthorized("Refresh token is invalid or expired.");
  }
}

async function requireAdminChallenge(repository, token, expectedType, now) {
  const challenge = await repository.findAdminAuthChallenge(hashToken(requireToken(token, "challenge_token")));
  if (!challenge || challenge.challengeType !== expectedType || challenge.consumedAt
    || challenge.attempts >= 5 || new Date(challenge.expiresAt).getTime() <= now.getTime()) {
    throw unauthorized("Authentication challenge is invalid or expired.");
  }
  return { challenge };
}

async function verifyAdminSecondFactor(repository, adminUser, input, config, now) {
  if (input?.recovery_code) {
    return repository.consumeAdminRecoveryCode(adminUser.id, hashToken(String(input.recovery_code).trim()), now.toISOString());
  }
  if (!adminUser.totpSecretEncrypted) return false;
  const secret = decryptTotpSecret(adminUser.totpSecretEncrypted, config.authTotpEncryptionSecret);
  const verification = verifyTotpCode({ secret, code: input?.code || input?.totp_code, now, lastCounter: adminUser.totpLastCounter });
  if (!verification.valid) return false;
  return repository.updateAdminTotpCounter(adminUser.id, adminUser.totpLastCounter, verification.counter);
}

function createRecoveryCodes() {
  return Array.from({ length: 8 }, () => createOpaqueToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase());
}

function secureMeta(requestMeta, config) {
  return { ...requestMeta, deviceHash: getDeviceHash(requestMeta, config) };
}

function getDeviceHash(requestMeta, config) {
  return requestMeta.deviceHash || hashDeviceFingerprint(requestMeta.deviceId, config.authDeviceHmacSecret);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function requireText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw badRequest(`${field} is required and must be at most ${maxLength} characters.`);
  return text;
}

export function createTestPrincipal(overrides = {}) {
  return {
    id: randomUUID(), email: "test@example.com", emailNormalized: "test@example.com", displayName: "",
    status: "normal", emailVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), ...overrides
  };
}
