import { randomUUID } from "node:crypto";

// In-memory double for the membership repository (V2-09-05/06).
export class MemoryMembershipRepository {
  constructor() {
    this.versions = [];   // config versions
    this.ledger = [];     // growth ledger rows
    this.keys = new Set(); // idempotency keys
  }

  async setActiveConfig({ tiers, adminId }) {
    for (const v of this.versions) v.active = false;
    const version = { id: randomUUID(), version: this.versions.length + 1, tiers: tiers || [], active: true, effectiveAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    this.versions.push(version);
    return { ...version };
  }
  async getActiveConfig() { const v = this.versions.find((x) => x.active); return v ? { ...v } : null; }
  async listConfigVersions() { return this.versions.slice().reverse(); }

  async accrue({ userId, deltaMinor, source, businessType, businessRef, idempotencyKey }) {
    if (this.keys.has(idempotencyKey)) return { entry: null, created: false };
    this.keys.add(idempotencyKey);
    const entry = { id: randomUUID(), userId, deltaGrowthMinor: deltaMinor, source, businessType: businessType || "", businessRef: businessRef || "", createdAt: new Date().toISOString() };
    this.ledger.push(entry);
    return { entry: { ...entry }, created: true };
  }
  async totalGrowth(userId) { return this.ledger.filter((l) => l.userId === userId).reduce((s, l) => s + l.deltaGrowthMinor, 0); }
  async listLedger(userId, limit = 50) { return this.ledger.filter((l) => l.userId === userId).slice(-limit).reverse().map((l) => ({ ...l })); }
}
