import { randomUUID } from "node:crypto";

// In-memory double for the account-risk repository (V2-09-08/09/10).
export class MemoryAccountRiskRepository {
  constructor() {
    this.events = [];
    this.externalIds = new Set();
    this.requests = new Map();
    this.history = [];
    this.userStatuses = new Map(); // user_id -> status
    this.blacklist = new Map();    // fingerprint -> entry
    this.flags = new Map();        // id -> flag
  }

  seedUser(userId, status = "normal") { this.userStatuses.set(userId, status); }

  async recordEvent({ userId, type, severity, detail, evidenceRef, autoRule, externalId }) {
    if (this.externalIds.has(externalId)) return { event: null, created: false };
    this.externalIds.add(externalId);
    const event = { id: randomUUID(), userId, type, severity: severity || "low", detail: detail || {}, evidenceRef: evidenceRef || "", autoRule: autoRule || "", externalId, createdAt: new Date().toISOString() };
    this.events.push(event);
    return { event: { ...event }, created: true };
  }
  async listEvents(userId) { return this.events.filter((e) => e.userId === userId).reverse().map((e) => ({ ...e })); }

  _activePending(userId) { return [...this.requests.values()].find((r) => r.userId === userId && r.status === "pending_review"); }

  async createLockRequest({ userId, targetStatus, reason, evidence, adminId }) {
    if (this._activePending(userId)) { const e = new Error("dup"); e.code = "ACTIVE_REQUEST_EXISTS"; throw e; }
    const req = { id: randomUUID(), userId, targetStatus, reason, evidence: evidence || [], status: "pending_review", initiatedByAdminId: adminId || null, approverAdminId: null, decisionReason: "", decidedAt: null, createdAt: new Date().toISOString() };
    this.requests.set(req.id, req);
    return { request: { ...req }, created: true };
  }
  async findRequestById(id) { const r = this.requests.get(id); return r ? { ...r } : null; }
  async listRequests({ status = null } = {}) { return [...this.requests.values()].filter((r) => !status || r.status === status).map((r) => ({ ...r })); }

  async approveAndLock({ requestId, approverAdminId }) {
    const req = this.requests.get(requestId);
    if (!req) return { notFound: true };
    if (req.status !== "pending_review") return { conflict: true, status: req.status };
    const fromStatus = this.userStatuses.get(req.userId) || "normal";
    if (!this.userStatuses.has(req.userId)) return { userNotFound: true };
    this.userStatuses.set(req.userId, req.targetStatus);
    req.status = "approved"; req.approverAdminId = approverAdminId; req.decidedAt = new Date().toISOString();
    this.history.push({ id: randomUUID(), userId: req.userId, fromStatus, toStatus: req.targetStatus, action: "lock_approved", actorAdminId: approverAdminId, reason: req.reason, createdAt: new Date().toISOString() });
    return { request: { ...req }, fromStatus, toStatus: req.targetStatus, userId: req.userId };
  }
  async rejectRequest({ requestId, approverAdminId, reason }) {
    const req = this.requests.get(requestId);
    if (!req || req.status !== "pending_review") return null;
    req.status = "rejected"; req.approverAdminId = approverAdminId; req.decisionReason = reason || ""; req.decidedAt = new Date().toISOString();
    return { ...req };
  }
  async unlockUser({ userId, approverAdminId, reason }) {
    if (!this.userStatuses.has(userId)) return { notFound: true };
    const from = this.userStatuses.get(userId);
    if (from === "normal") return { alreadyNormal: true };
    this.userStatuses.set(userId, "normal");
    this.history.push({ id: randomUUID(), userId, fromStatus: from, toStatus: "normal", action: "unlock", actorAdminId: approverAdminId, reason: reason || "", createdAt: new Date().toISOString() });
    return { fromStatus: from };
  }
  async userStatus(userId) { return this.userStatuses.get(userId) || null; }
  async statusHistory(userId) { return this.history.filter((h) => h.userId === userId).map((h) => ({ ...h })); }

  async addBlacklistEntry({ fingerprint, fuzzyKey, countryCode, reason, adminId }) {
    if (this.blacklist.has(fingerprint)) return { entry: null, created: false };
    const entry = { id: randomUUID(), fingerprint, fuzzyKey: fuzzyKey || "", countryCode: countryCode || "", reason: reason || "", createdAt: new Date().toISOString() };
    this.blacklist.set(fingerprint, entry);
    return { entry: { ...entry }, created: true };
  }
  async listBlacklist() { return [...this.blacklist.values()].map((e) => ({ ...e })); }
  async matchExact(fingerprint) { const e = this.blacklist.get(fingerprint); return e ? { ...e } : null; }
  async matchFuzzy(fuzzyKey, excludeFingerprint) {
    if (!fuzzyKey) return [];
    return [...this.blacklist.values()].filter((e) => e.fuzzyKey === fuzzyKey && e.fingerprint !== excludeFingerprint).map((e) => ({ ...e }));
  }
  async createReviewFlag({ userId, candidate, matchKind, blacklistId }) {
    const flag = { id: randomUUID(), userId: userId || null, candidate: candidate || {}, matchKind, blacklistId: blacklistId || null, status: "pending", createdAt: new Date().toISOString() };
    this.flags.set(flag.id, flag);
    return { ...flag };
  }
  async listReviewFlags({ status = "pending" } = {}) { return [...this.flags.values()].filter((f) => !status || f.status === status).map((f) => ({ ...f })); }
  async decideReviewFlag({ flagId, status }) {
    const f = this.flags.get(flagId);
    if (!f || f.status !== "pending") return null;
    f.status = status;
    return { ...f };
  }
}
