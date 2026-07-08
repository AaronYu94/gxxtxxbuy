import { randomUUID } from "node:crypto";
import { normalizeAdminUser, normalizeSession, normalizeUser } from "../../src/auth/auth-repository.js";

export class MemoryAuthRepository {
  constructor() {
    this.users = new Map();
    this.usersByEmail = new Map();
    this.adminUsers = new Map();
    this.adminUsersByEmail = new Map();
    this.sessions = new Map();
    this.sessionsByAccess = new Map();
    this.sessionsByRefresh = new Map();
    this.adminAccess = new Map();
  }

  async findUserByEmail(emailNormalized) {
    return clone(this.users.get(this.usersByEmail.get(emailNormalized)));
  }

  async findUserById(id) {
    return clone(this.users.get(id));
  }

  async createUser(input) {
    if (this.usersByEmail.has(input.emailNormalized)) {
      const error = new Error("duplicate user email");
      error.code = "DUPLICATE_EMAIL";
      throw error;
    }
    const now = new Date().toISOString();
    const user = normalizeUser({
      id: randomUUID(),
      email: input.email,
      emailNormalized: input.emailNormalized,
      displayName: input.displayName || "",
      passwordHash: input.passwordHash,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    this.users.set(user.id, user);
    this.usersByEmail.set(user.emailNormalized, user.id);
    return clone(user);
  }

  async findAdminByEmail(emailNormalized) {
    return clone(this.adminUsers.get(this.adminUsersByEmail.get(emailNormalized)));
  }

  async findAdminById(id) {
    return clone(this.adminUsers.get(id));
  }

  async createAdminUser(input) {
    if (this.adminUsersByEmail.has(input.emailNormalized)) {
      const error = new Error("duplicate admin email");
      error.code = "DUPLICATE_EMAIL";
      throw error;
    }
    const now = new Date().toISOString();
    const adminUser = normalizeAdminUser({
      id: randomUUID(),
      email: input.email,
      emailNormalized: input.emailNormalized,
      displayName: input.displayName || "",
      passwordHash: input.passwordHash,
      status: input.status || "active",
      createdAt: now,
      updatedAt: now
    });
    this.adminUsers.set(adminUser.id, adminUser);
    this.adminUsersByEmail.set(adminUser.emailNormalized, adminUser.id);
    this.adminAccess.set(adminUser.id, {
      roles: input.roles || [],
      permissions: input.permissions || []
    });
    return clone(adminUser);
  }

  async markAdminLogin(id) {
    const adminUser = this.adminUsers.get(id);
    if (adminUser) {
      adminUser.lastLoginAt = new Date().toISOString();
    }
  }

  async createSession(input) {
    const now = new Date().toISOString();
    const session = normalizeSession({
      id: randomUUID(),
      actorType: input.actorType,
      userId: input.userId,
      adminUserId: input.adminUserId,
      accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      ipHash: input.ipHash || "",
      createdAt: now,
      updatedAt: now
    });
    this.sessions.set(session.id, session);
    this.sessionsByAccess.set(session.accessTokenHash, session.id);
    this.sessionsByRefresh.set(session.refreshTokenHash, session.id);
    return clone(session);
  }

  async findSessionByAccessTokenHash(accessTokenHash, actorType) {
    const session = this.sessions.get(this.sessionsByAccess.get(accessTokenHash));
    return session?.actorType === actorType ? clone(session) : null;
  }

  async findSessionByRefreshTokenHash(refreshTokenHash, actorType) {
    const session = this.sessions.get(this.sessionsByRefresh.get(refreshTokenHash));
    return session?.actorType === actorType ? clone(session) : null;
  }

  async rotateSession(sessionId, input) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    this.sessionsByAccess.delete(session.accessTokenHash);
    this.sessionsByRefresh.delete(session.refreshTokenHash);
    session.accessTokenHash = input.accessTokenHash;
    session.refreshTokenHash = input.refreshTokenHash;
    session.expiresAt = input.expiresAt;
    session.refreshExpiresAt = input.refreshExpiresAt;
    session.revokedAt = null;
    session.updatedAt = new Date().toISOString();
    session.lastUsedAt = session.updatedAt;
    this.sessionsByAccess.set(session.accessTokenHash, session.id);
    this.sessionsByRefresh.set(session.refreshTokenHash, session.id);
    return clone(session);
  }

  async revokeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revokedAt = new Date().toISOString();
      session.updatedAt = session.revokedAt;
    }
  }

  async getAdminAccess(adminUserId) {
    const access = this.adminAccess.get(adminUserId) || { roles: [], permissions: [] };
    return {
      roles: [...access.roles],
      permissions: [...access.permissions]
    };
  }
}

export class MemoryAuditRepository {
  constructor(options = {}) {
    this.logs = [];
    this.fail = options.fail || false;
  }

  async insertAuditLog(event) {
    if (this.fail) {
      throw new Error("audit insert failed");
    }
    this.logs.push(clone(event));
  }
}

export function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
