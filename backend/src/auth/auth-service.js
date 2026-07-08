import { randomUUID } from "node:crypto";
import { conflict, unauthorized } from "../errors/app-error.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { hashToken } from "../security/token.js";
import { requireEmail, optionalDisplayName, requirePassword, requireToken } from "./input.js";
import { createSessionPayload, toSessionResponse } from "./session.js";

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

export function createAuthService({ repository, auditLogger, clock = () => new Date() }) {
  if (!repository) {
    throw new Error("Auth repository is required.");
  }

  return {
    async registerUser(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = requirePassword(input?.password);
      const displayName = optionalDisplayName(input?.display_name ?? input?.displayName);

      const existing = await repository.findUserByEmail(emailNormalized);
      if (existing && !existing.deletedAt) {
        throw conflict("Email already registered.");
      }

      const user = await createUserSafely(repository, {
        email: input.email.trim(),
        emailNormalized,
        displayName,
        passwordHash: await hashPassword(password)
      });
      const sessionResult = await createActorSession(repository, "user", user, requestMeta, clock());

      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
        metadata: { email: user.email, password: "[REDACTED]" },
        requestId: requestMeta.requestId,
        ipHash: sessionResult.session.ipHash
      }, { critical: false });

      return {
        user: publicUser(user),
        session: toSessionResponse(sessionResult.tokens, sessionResult.session)
      };
    },

    async loginUser(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = String(input?.password || "");
      const user = await repository.findUserByEmail(emailNormalized);

      if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }

      const sessionResult = await createActorSession(repository, "user", user, requestMeta, clock());
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "auth.login",
        resourceType: "user",
        resourceId: user.id,
        metadata: { email: user.email },
        requestId: requestMeta.requestId,
        ipHash: sessionResult.session.ipHash
      }, { critical: false });

      return {
        user: publicUser(user),
        session: toSessionResponse(sessionResult.tokens, sessionResult.session)
      };
    },

    async refreshUserSession(input, requestMeta = {}) {
      return refreshActorSession(repository, "user", input, requestMeta, clock());
    },

    async authenticateUser(accessToken) {
      const session = await requireActiveAccessSession(repository, "user", accessToken, clock());
      const user = await repository.findUserById(session.userId);
      if (!user || user.status !== "active") {
        throw unauthorized("User session is no longer valid.");
      }
      return { user: publicUser(user), session };
    },

    async loginAdmin(input, requestMeta = {}) {
      const emailNormalized = requireEmail(input?.email);
      const password = String(input?.password || "");
      const adminUser = await repository.findAdminByEmail(emailNormalized);

      if (!adminUser || adminUser.status !== "active" || !(await verifyPassword(password, adminUser.passwordHash))) {
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }

      const access = await repository.getAdminAccess(adminUser.id);
      const sessionResult = await createActorSession(repository, "admin", adminUser, requestMeta, clock());
      await repository.markAdminLogin?.(adminUser.id);

      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "admin.auth.login",
        resourceType: "admin_user",
        resourceId: adminUser.id,
        metadata: { email: adminUser.email, roles: access.roles },
        requestId: requestMeta.requestId,
        ipHash: sessionResult.session.ipHash
      }, { critical: true });

      return {
        admin_user: publicAdminUser(adminUser),
        roles: access.roles,
        permissions: access.permissions,
        session: toSessionResponse(sessionResult.tokens, sessionResult.session)
      };
    },

    async refreshAdminSession(input, requestMeta = {}) {
      return refreshActorSession(repository, "admin", input, requestMeta, clock());
    },

    async authenticateAdmin(accessToken) {
      const session = await requireActiveAccessSession(repository, "admin", accessToken, clock());
      const adminUser = await repository.findAdminById(session.adminUserId);
      if (!adminUser || adminUser.status !== "active") {
        throw unauthorized("Admin session is no longer valid.");
      }
      const access = await repository.getAdminAccess(adminUser.id);
      return {
        adminUser: publicAdminUser(adminUser),
        roles: access.roles,
        permissions: access.permissions,
        session
      };
    },

    async revokeSession(sessionId) {
      await repository.revokeSession(sessionId);
    }
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName || "",
    status: user.status,
    created_at: user.createdAt
  };
}

export function publicAdminUser(adminUser) {
  return {
    id: adminUser.id,
    email: adminUser.email,
    display_name: adminUser.displayName || "",
    status: adminUser.status,
    last_login_at: adminUser.lastLoginAt,
    created_at: adminUser.createdAt
  };
}

async function createUserSafely(repository, input) {
  try {
    return await repository.createUser(input);
  } catch (error) {
    if (error.code === "23505" || error.code === "DUPLICATE_EMAIL") {
      throw conflict("Email already registered.");
    }
    throw error;
  }
}

async function createActorSession(repository, actorType, principal, requestMeta, now) {
  const tokens = createSessionPayload(actorType, requestMeta, now);
  const session = await repository.createSession({
    actorType,
    userId: actorType === "user" ? principal.id : null,
    adminUserId: actorType === "admin" ? principal.id : null,
    ...tokens
  });
  return { tokens, session };
}

async function refreshActorSession(repository, actorType, input, _requestMeta, now) {
  const refreshToken = requireToken(input?.refresh_token ?? input?.refreshToken, "refresh_token");
  const session = await repository.findSessionByRefreshTokenHash(hashToken(refreshToken), actorType);
  ensureRefreshSession(session, now);

  const principal = actorType === "admin"
    ? await repository.findAdminById(session.adminUserId)
    : await repository.findUserById(session.userId);
  if (!principal || principal.status !== "active") {
    throw unauthorized("Session is no longer valid.");
  }

  const tokens = createSessionPayload(actorType, {}, now);
  const rotated = await repository.rotateSession(session.id, tokens);
  const access = actorType === "admin" ? await repository.getAdminAccess(principal.id) : null;

  return {
    ...(actorType === "admin"
      ? {
          admin_user: publicAdminUser(principal),
          roles: access.roles,
          permissions: access.permissions
        }
      : { user: publicUser(principal) }),
    session: toSessionResponse(tokens, rotated)
  };
}

async function requireActiveAccessSession(repository, actorType, accessToken, now) {
  const token = requireToken(accessToken, "access_token");
  const session = await repository.findSessionByAccessTokenHash(hashToken(token), actorType);
  if (!session || session.revokedAt) {
    throw unauthorized("Session is invalid or expired.");
  }
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    throw unauthorized("Session is invalid or expired.");
  }
  return session;
}

function ensureRefreshSession(session, now) {
  if (!session || session.revokedAt) {
    throw unauthorized("Refresh token is invalid or expired.");
  }
  if (new Date(session.refreshExpiresAt).getTime() <= now.getTime()) {
    throw unauthorized("Refresh token is invalid or expired.");
  }
}

export function createTestPrincipal(overrides = {}) {
  return {
    id: randomUUID(),
    email: "test@example.com",
    emailNormalized: "test@example.com",
    displayName: "",
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}
