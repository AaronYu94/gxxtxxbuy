import { randomUUID } from "node:crypto";
import { normalizeAdminUser, normalizeSession, normalizeUser } from "../../src/auth/auth-repository.js";
import { generateTotpCode } from "../../src/security/totp.js";

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
    this.emailTokens = new Map();
    this.devices = new Map();
    this.loginAttempts = [];
    this.adminChallenges = new Map();
    this.recoveryCodes = new Map();
    this.reauthChallenges = new Map();
  }

  async findUserByEmail(email) { return clone(this.users.get(this.usersByEmail.get(email))); }
  async findUserById(id) { return clone(this.users.get(id)); }

  async createUser(input) {
    if (this.usersByEmail.has(input.emailNormalized)) throw codedError("DUPLICATE_EMAIL", "duplicate user email");
    const now = new Date().toISOString();
    const user = normalizeUser({
      id: randomUUID(), email: input.email, emailNormalized: input.emailNormalized,
      displayName: input.displayName || "", passwordHash: input.passwordHash,
      status: input.status || "normal", emailVerifiedAt: input.emailVerifiedAt || null,
      phone: input.phone || null, phoneVerifiedAt: input.phoneVerifiedAt || null,
      countryCode: input.countryCode || null, defaultLocale: input.defaultLocale || "en-US",
      defaultCurrency: input.defaultCurrency || "USD", version: input.version || 1,
      deletionRequestedAt: null, securityLockedUntil: null, createdAt: now, updatedAt: now
    });
    this.users.set(user.id, user);
    this.usersByEmail.set(user.emailNormalized, user.id);
    return clone(user);
  }

  async markUserEmailVerified(id, at) {
    const user = this.users.get(id);
    if (!user) return null;
    user.emailVerifiedAt ||= at;
    return clone(user);
  }

  async setUserSecurityLock(id, until) {
    const user = this.users.get(id);
    if (!user) return null;
    user.securityLockedUntil = until;
    return clone(user);
  }

  async createEmailVerificationToken(input) {
    const token = { id: randomUUID(), ...input, usedAt: null, createdAt: new Date().toISOString() };
    this.emailTokens.set(token.tokenHash, token);
    return clone(token);
  }

  async findEmailVerificationToken(hash) { return clone(this.emailTokens.get(hash)); }
  async findLatestEmailVerificationToken(userId, purpose) {
    return clone([...this.emailTokens.values()]
      .filter((token) => token.userId === userId && token.purpose === purpose)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
  }
  async consumeEmailVerificationToken(id, usedAt) {
    const token = [...this.emailTokens.values()].find((item) => item.id === id);
    if (!token || token.usedAt) return null;
    token.usedAt = usedAt;
    return clone(token);
  }

  async findUserDevice(userId, deviceHash) { return clone(this.devices.get(`${userId}:${deviceHash}`)); }
  async upsertUserDevice(input) {
    const key = `${input.userId}:${input.deviceHash}`;
    const device = this.devices.get(key) || {
      id: randomUUID(), userId: input.userId, deviceHash: input.deviceHash,
      trustedAt: null, trustRevokedAt: null, createdAt: new Date().toISOString()
    };
    device.label = input.label || device.label || "";
    device.lastSeenAt = input.lastSeenAt;
    this.devices.set(key, device);
    return clone(device);
  }
  async trustUserDevice(userId, deviceHash, at) {
    const device = this.devices.get(`${userId}:${deviceHash}`);
    if (!device) return null;
    device.trustedAt = at;
    device.trustRevokedAt = null;
    return clone(device);
  }
  async revokeUserDeviceTrust(userId) {
    for (const device of this.devices.values()) {
      if (device.userId === userId && !device.trustRevokedAt) device.trustRevokedAt = new Date().toISOString();
    }
  }

  async recordLoginAttempt(input) { this.loginAttempts.push(clone(input)); }
  async countRecentFailedLogins(actorType, principalHash, since) {
    return this.loginAttempts.filter((attempt) => attempt.actorType === actorType
      && attempt.principalHash === principalHash && !attempt.succeeded
      && new Date(attempt.attemptedAt) >= new Date(since)).length;
  }

  async findAdminByEmail(email) { return clone(this.adminUsers.get(this.adminUsersByEmail.get(email))); }
  async findAdminById(id) { return clone(this.adminUsers.get(id)); }
  async createAdminUser(input) {
    if (this.adminUsersByEmail.has(input.emailNormalized)) throw codedError("DUPLICATE_EMAIL", "duplicate admin email");
    if ([...this.adminUsers.values()].some((admin) => input.employeeNo && admin.employeeNo === input.employeeNo)) {
      throw codedError("DUPLICATE_EMPLOYEE_NO", "duplicate employee number");
    }
    const now = new Date().toISOString();
    const admin = normalizeAdminUser({
      id: randomUUID(), email: input.email, emailNormalized: input.emailNormalized,
      displayName: input.displayName || "", passwordHash: input.passwordHash,
      status: input.status || "enabled", employeeNo: input.employeeNo || null,
      departmentCode: input.departmentCode || null, organizationCode: input.organizationCode || null,
      totpSecretEncrypted: input.totpSecretEncrypted || null, totpEnabledAt: input.totpEnabledAt || null,
      totpLastCounter: input.totpLastCounter ?? null, createdAt: now, updatedAt: now
    });
    this.adminUsers.set(admin.id, admin);
    this.adminUsersByEmail.set(admin.emailNormalized, admin.id);
    this.adminAccess.set(admin.id, { roles: input.roles || [], permissions: input.permissions || [] });
    return clone(admin);
  }
  async markAdminLogin(id) {
    const admin = this.adminUsers.get(id);
    if (admin) admin.lastLoginAt = new Date().toISOString();
  }

  async createAdminAuthChallenge(input) {
    const challenge = { id: randomUUID(), ...input, attempts: 0, pendingTotpSecretEncrypted: null, consumedAt: null, createdAt: new Date().toISOString() };
    this.adminChallenges.set(challenge.challengeTokenHash, challenge);
    return clone(challenge);
  }
  async findAdminAuthChallenge(hash) { return clone(this.adminChallenges.get(hash)); }
  async setAdminChallengeSecret(id, secret) {
    const challenge = [...this.adminChallenges.values()].find((item) => item.id === id && !item.consumedAt);
    if (!challenge) return null;
    challenge.pendingTotpSecretEncrypted = secret;
    return clone(challenge);
  }
  async incrementAdminChallengeAttempts(id) {
    const challenge = [...this.adminChallenges.values()].find((item) => item.id === id);
    if (challenge && !challenge.consumedAt) challenge.attempts += 1;
  }
  async consumeAdminAuthChallenge(id, at) {
    const challenge = [...this.adminChallenges.values()].find((item) => item.id === id);
    if (!challenge || challenge.consumedAt) return null;
    challenge.consumedAt = at;
    return clone(challenge);
  }
  async enableAdminTotp(id, encrypted, counter, at) {
    const admin = this.adminUsers.get(id);
    if (!admin) return null;
    admin.totpSecretEncrypted = encrypted;
    admin.totpLastCounter = counter;
    admin.totpEnabledAt = at;
    return clone(admin);
  }
  async updateAdminTotpCounter(id, expected, counter) {
    const admin = this.adminUsers.get(id);
    if (!admin || admin.totpLastCounter !== expected) return false;
    admin.totpLastCounter = counter;
    return true;
  }
  async replaceAdminRecoveryCodes(id, hashes) {
    this.recoveryCodes.set(id, new Map(hashes.map((hash) => [hash, null])));
  }
  async consumeAdminRecoveryCode(id, hash, at) {
    const codes = this.recoveryCodes.get(id);
    if (!codes?.has(hash) || codes.get(hash)) return false;
    codes.set(hash, at);
    return true;
  }

  async createAdminReauthChallenge(input) {
    const challenge = { id: randomUUID(), ...input, consumedAt: null, createdAt: new Date().toISOString() };
    this.reauthChallenges.set(challenge.challengeTokenHash, challenge);
    return clone(challenge);
  }
  async findAdminReauthChallenge(hash) { return clone(this.reauthChallenges.get(hash)); }
  async consumeAdminReauthChallenge(id, at) {
    const challenge = [...this.reauthChallenges.values()].find((item) => item.id === id);
    if (!challenge || challenge.consumedAt) return null;
    challenge.consumedAt = at;
    return clone(challenge);
  }

  async createSession(input) {
    const now = new Date().toISOString();
    const session = normalizeSession({ id: randomUUID(), ...input, createdAt: now, updatedAt: now });
    this.sessions.set(session.id, session);
    this.sessionsByAccess.set(session.accessTokenHash, session.id);
    this.sessionsByRefresh.set(session.refreshTokenHash, session.id);
    return clone(session);
  }
  async findSessionByAccessTokenHash(hash, type) {
    const session = this.sessions.get(this.sessionsByAccess.get(hash));
    return session?.actorType === type ? clone(session) : null;
  }
  async findSessionByRefreshTokenHash(hash, type) {
    const session = this.sessions.get(this.sessionsByRefresh.get(hash));
    return session?.actorType === type ? clone(session) : null;
  }
  async rotateSession(id, input) {
    const session = this.sessions.get(id);
    if (!session) return null;
    this.sessionsByAccess.delete(session.accessTokenHash);
    this.sessionsByRefresh.delete(session.refreshTokenHash);
    Object.assign(session, {
      accessTokenHash: input.accessTokenHash, refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt, refreshExpiresAt: input.refreshExpiresAt,
      revokedAt: null, lastUsedAt: new Date().toISOString()
    });
    this.sessionsByAccess.set(session.accessTokenHash, id);
    this.sessionsByRefresh.set(session.refreshTokenHash, id);
    return clone(session);
  }
  async revokeSession(id) {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = new Date().toISOString();
  }
  async revokeActorSessions(type, actorId) {
    for (const session of this.sessions.values()) {
      if (session.actorType === type && (session.userId === actorId || session.adminUserId === actorId)) {
        session.revokedAt ||= new Date().toISOString();
      }
    }
  }
  async disableAdminUser(id) {
    const admin = this.adminUsers.get(id);
    if (!admin) return null;
    admin.status = "disabled";
    await this.revokeActorSessions("admin", id);
    return clone(admin);
  }
  async assignAdminRole(id, roleCode) {
    const access = this.adminAccess.get(id);
    if (!access || access.roles.length) return false;
    access.roles = [roleCode];
    return true;
  }
  async getAdminAccess(id) {
    const access = this.adminAccess.get(id) || { roles: [], permissions: [] };
    return { roles: [...access.roles], permissions: [...access.permissions] };
  }
}

export class MemoryAuditRepository {
  constructor(options = {}) { this.logs = []; this.fail = options.fail || false; }
  async insertAuditLog(event) {
    if (this.fail) throw new Error("audit insert failed");
    this.logs.push(clone(event));
  }
}

function codedError(code, message) { const error = new Error(message); error.code = code; return error; }
export function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }

export async function registerVerifiedUser(baseUrl, email = "buyer@example.com", password = "CorrectHorse123") {
  const deviceId = `test-device-${email}`;
  const registration = await testPost(baseUrl, "/auth/register", { email, password }, deviceId);
  if (registration.response.status !== 201) throw new Error(`registration failed: ${registration.response.status}`);
  const verification = await testPost(baseUrl, "/auth/verify-email", { token: registration.body.verification_token }, deviceId);
  if (verification.response.status !== 200) throw new Error(`email verification failed: ${verification.response.status}`);
  const login = await testPost(baseUrl, "/auth/login", { email, password }, deviceId);
  if (login.response.status !== 200 || !login.body.session) throw new Error(`user login failed: ${login.response.status}`);
  return { token: login.body.session.access_token, user: login.body.user, session: login.body.session };
}

export async function loginAdminWithTotp(baseUrl, email, password = "AdminPass123") {
  const deviceId = `test-admin-device-${email}`;
  const first = await testPost(baseUrl, "/admin/auth/login", { email, password }, deviceId);
  if (first.response.status !== 200 || !first.body.challenge_token) throw new Error(`admin password step failed: ${first.response.status}`);
  if (first.body.setup_required) {
    const setup = await testPost(baseUrl, "/admin/auth/totp/setup", { challenge_token: first.body.challenge_token }, deviceId);
    const confirmed = await testPost(baseUrl, "/admin/auth/totp/confirm", {
      challenge_token: first.body.challenge_token,
      code: generateTotpCode(setup.body.secret)
    }, deviceId);
    if (confirmed.response.status !== 200 || !confirmed.body.session) throw new Error(`admin TOTP setup failed: ${confirmed.response.status}`);
    return confirmed.body;
  }
  const admin = await findMemoryAdminSecretForTest(baseUrl, email);
  const verified = await testPost(baseUrl, "/admin/auth/verify-totp", {
    challenge_token: first.body.challenge_token,
    recovery_code: admin.recoveryCode
  }, deviceId);
  if (verified.response.status !== 200 || !verified.body.session) throw new Error(`admin TOTP step failed: ${verified.response.status}`);
  return verified.body;
}

// The helper only supports first login setup. Repeated-login tests retain a recovery code explicitly.
async function findMemoryAdminSecretForTest() {
  throw new Error("Repeated admin login requires an explicit TOTP code or recovery code in the test.");
}

async function testPost(baseUrl, path, body, deviceId) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": deviceId },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
