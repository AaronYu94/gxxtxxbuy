import { randomUUID } from "node:crypto";

// In-memory double for the referral repository (V2-11-01/02/03).
export class MemoryReferralRepository {
  constructor() { this.codes = new Map(); this.bindings = new Map(); this.attempts = []; this.tierVersions = []; this.effective = []; this.effKeys = new Set(); }

  async ensureCode(userId, code) {
    for (const c of this.codes.values()) if (c.userId === userId) return { ...c };
    const c = { id: randomUUID(), userId, code, createdAt: new Date().toISOString() };
    this.codes.set(c.code, c);
    return { ...c };
  }
  async findCodeByUser(userId) { for (const c of this.codes.values()) if (c.userId === userId) return { ...c }; return null; }
  async findCode(code) { const c = this.codes.get(code); return c ? { ...c } : null; }

  async findBindingByInvitee(inviteeId) { const b = this.bindings.get(inviteeId); return b ? { ...b } : null; }
  async findInviterChain(userId, maxDepth = 20) {
    const chain = []; let cur = userId;
    for (let i = 0; i < maxDepth; i += 1) { const b = this.bindings.get(cur); if (!b) break; chain.push(b.inviterUserId); cur = b.inviterUserId; }
    return chain;
  }
  async createBinding({ inviteeId, inviterId, code, source }) {
    if (this.bindings.has(inviteeId)) return { binding: { ...this.bindings.get(inviteeId) }, created: false };
    const b = { id: randomUUID(), inviteeUserId: inviteeId, inviterUserId: inviterId, code: code || "", source: source || "signup", createdAt: new Date().toISOString() };
    this.bindings.set(inviteeId, b);
    return { binding: { ...b }, created: true };
  }
  async recordAttempt({ inviteeId, code, reason }) { this.attempts.push({ inviteeId, code, reason }); }
  async listInvitees(inviterId) { return [...this.bindings.values()].filter((b) => b.inviterUserId === inviterId).map((b) => ({ inviteeId: b.inviteeUserId, createdAt: b.createdAt })); }
  async countInvitees(inviterId) { return [...this.bindings.values()].filter((b) => b.inviterUserId === inviterId).length; }
  async findInviterOf(inviteeId) { const b = this.bindings.get(inviteeId); return b ? b.inviterUserId : null; }

  async setActiveTierConfig({ tiers, adminId }) {
    for (const v of this.tierVersions) v.active = false;
    const v = { id: randomUUID(), version: this.tierVersions.length + 1, tiers: tiers || [], active: true, effectiveAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    this.tierVersions.push(v);
    return { ...v };
  }
  async getActiveTierConfig() { const v = this.tierVersions.find((x) => x.active); return v ? { ...v } : null; }
  async listTierConfigVersions() { return this.tierVersions.slice().reverse(); }

  async accrueEffective({ promoterId, deltaMinor, source, businessRef, idempotencyKey }) {
    if (this.effKeys.has(idempotencyKey)) return { entry: null, created: false };
    this.effKeys.add(idempotencyKey);
    const e = { id: randomUUID(), promoterId, deltaMinor, source, businessRef: businessRef || "", createdAt: new Date().toISOString() };
    this.effective.push(e);
    return { entry: { ...e }, created: true };
  }
  async totalEffective(promoterId) { return this.effective.filter((e) => e.promoterId === promoterId).reduce((s, e) => s + e.deltaMinor, 0); }
  async listEffective(promoterId, limit = 50) { return this.effective.filter((e) => e.promoterId === promoterId).slice(-limit).reverse(); }
}
