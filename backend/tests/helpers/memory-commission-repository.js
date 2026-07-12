import { randomUUID } from "node:crypto";

export function acct(userId, sub) { return `commission:${userId}:${sub}`; }
export const PLATFORM_POOL = "commission:platform:pool";

// In-memory double for the commission repository (V2-11-06). Balances are computed
// from the entries, exactly like the PG double-entry ledger.
export class MemoryCommissionRepository {
  constructor() { this.transactions = []; this.entries = []; this.keys = new Set(); this.withdrawals = new Map(); this.qualifications = new Map(); this.disciplinary = []; }

  async post({ comNo, promoterUserId, inviteeUserId, businessType, businessRef, idempotencyKey, amountMinor, baseMinor, commissionBps, tierLevel, entries }) {
    const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountMinor, 0);
    const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountMinor, 0);
    if (debit !== credit) { const e = new Error("unbalanced"); e.code = "UNBALANCED"; throw e; }
    if (this.keys.has(idempotencyKey)) { const t = this.transactions.find((x) => x.idempotencyKey === idempotencyKey); return { transaction: { ...t }, created: false }; }
    this.keys.add(idempotencyKey);
    const tx = { id: randomUUID(), comNo, promoterUserId, inviteeUserId: inviteeUserId || null, businessType, businessRef: businessRef || "", idempotencyKey, amountMinor, baseMinor: baseMinor || 0, commissionBps: commissionBps || 0, tierLevel: tierLevel || 0, status: "posted", createdAt: new Date().toISOString() };
    this.transactions.push(tx);
    for (const e of entries) this.entries.push({ transactionId: tx.id, account: e.account, direction: e.direction, amountMinor: e.amountMinor });
    return { transaction: { ...tx }, created: true };
  }
  _bal(account) { return this.entries.filter((e) => e.account === account).reduce((s, e) => s + (e.direction === "credit" ? e.amountMinor : -e.amountMinor), 0); }
  async balance(account) { return this._bal(account); }
  async wallet(userId) { return { pending: this._bal(acct(userId, "pending")), available: this._bal(acct(userId, "available")), frozen: this._bal(acct(userId, "frozen")), settled: this._bal(acct(userId, "settled")) }; }
  async listTransactions(promoterUserId, limit = 50) { return this.transactions.filter((t) => t.promoterUserId === promoterUserId).slice(-limit).reverse().map((t) => ({ ...t })); }
  async findByIdempotencyKey(idempotencyKey) { const t = this.transactions.find((x) => x.idempotencyKey === idempotencyKey); return t ? { ...t } : null; }
  async findByBusinessRef(businessType, businessRef) { return this.transactions.filter((t) => t.businessType === businessType && t.businessRef === businessRef).map((t) => ({ ...t })); }
  async ledgerSum() { return this.entries.reduce((s, e) => s + (e.direction === "credit" ? e.amountMinor : -e.amountMinor), 0); }

  async createWithdrawal({ wdNo, promoterUserId, amountMinor, bankAccountRef, bankLast4, freezeTxId, idempotencyKey }) {
    const w = { id: randomUUID(), wdNo, promoterUserId, amountMinor, bankAccountRef: bankAccountRef || "", bankLast4: bankLast4 || "", status: "pending_review", freezeTxId, settleTxId: null, decisionReason: "", idempotencyKey, createdAt: new Date().toISOString() };
    this.withdrawals.set(w.id, w);
    return { ...w };
  }
  async findWithdrawal(id) { const w = this.withdrawals.get(id); return w ? { ...w } : null; }
  async listWithdrawals({ status = null } = {}) { return [...this.withdrawals.values()].filter((w) => !status || w.status === status).map((w) => ({ ...w })); }
  async setWithdrawalStatus({ id, fromStatus, toStatus, reviewerAdminId, reason, settleTxId }) {
    const w = this.withdrawals.get(id);
    if (!w || w.status !== fromStatus) return null;
    w.status = toStatus; if (reviewerAdminId) w.reviewerAdminId = reviewerAdminId; if (reason != null) w.decisionReason = reason; if (settleTxId) w.settleTxId = settleTxId;
    return { ...w };
  }
  async getQualification(promoterUserId) { return this.qualifications.get(promoterUserId) || { promoterUserId, status: "active", reason: "" }; }
  async setQualification({ promoterUserId, status, reason }) { const q = { promoterUserId, status, reason: reason || "" }; this.qualifications.set(promoterUserId, q); return { ...q }; }
  async addDisciplinaryRecord({ promoterUserId, action, reason, evidence, adminId }) { const r = { id: randomUUID(), promoterUserId, action, reason, evidence: evidence || [], adminId }; this.disciplinary.push(r); return r; }
}
