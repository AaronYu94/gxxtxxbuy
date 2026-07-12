import { randomUUID } from "node:crypto";
import { assertBalanced, walletDeltas } from "../../src/finance/finance-repository.js";
import { generateBusinessNumber } from "../../src/core/business-number.js";

// In-memory double for the finance repository. Mirrors the production invariants:
// entries must balance, a posted balance move cannot overdraw, and an idempotency
// key makes a replay a no-op.
export class MemoryFinanceRepository {
  constructor() {
    this.wallets = new Map();
    this.records = []; // { tx, entries }
    this.byIdem = new Map();
    this.rates = new Map(); // currency -> version rows
    this.topUps = new Map();
    this.withdrawals = new Map();
    this.adjustments = new Map();
    this.batches = new Map();
    this.diffs = [];
  }

  async listTopUpExceptions({ statuses = ["failed", "expired", "exception"], limit = 50, offset = 0 } = {}) {
    return Array.from(this.topUps.values())
      .filter((t) => statuses.includes(t.systemStatus))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(offset, offset + limit).map((t) => ({ ...t }));
  }

  async findReconciliationBatch(fileHash) {
    for (const b of this.batches.values()) if (b.fileHash === fileHash) return { ...b };
    return null;
  }

  async createReconciliationBatch({ fileHash, provider, importedByAdminId, recordCount, diffs }) {
    const now = new Date().toISOString();
    const batch = { id: randomUUID(), fileHash, provider, recordCount, diffCount: diffs.length, importedByAdminId: importedByAdminId || null, createdAt: now };
    this.batches.set(batch.id, batch);
    diffs.forEach((d) => this.diffs.push({
      id: randomUUID(), batchId: batch.id, providerTxnId: d.providerTxnId, diffType: d.diffType,
      providerAmountMinor: d.providerAmountMinor ?? null, localAmountMinor: d.localAmountMinor ?? null,
      providerCurrency: d.providerCurrency || "CNY", cnyMinor: d.cnyMinor ?? null, usdMinor: d.usdMinor ?? null,
      detail: d.detail || {}, createdAt: now
    }));
    return { ...batch };
  }

  async listReconciliationDiffs(batchId) {
    return this.diffs.filter((d) => d.batchId === batchId).map((d) => ({ ...d }));
  }

  async createAdjustment(input) {
    const now = new Date().toISOString();
    const a = {
      id: randomUUID(), adjustmentNo: input.adjustmentNo, userId: input.userId, direction: input.direction,
      amountCnyMinor: input.amountMinor, reason: input.reason, evidence: input.evidence || [],
      businessRef: input.businessRef || "", status: "pending_review", initiatorAdminId: input.initiatorAdminId || null,
      approverAdminId: null, reauthRef: "", executionTxId: null, failureReason: "", createdAt: now, updatedAt: now
    };
    this.adjustments.set(a.id, a);
    return { ...a };
  }

  async findAdjustment(id) {
    const a = this.adjustments.get(id);
    return a ? { ...a } : null;
  }

  async listAdjustments(limit = 50) {
    return Array.from(this.adjustments.values())
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))).slice(0, limit).map((a) => ({ ...a }));
  }

  async markAdjustment(id, patch) {
    const a = this.adjustments.get(id);
    if (!a) return null;
    if (patch.status) a.status = patch.status;
    if (patch.approverAdminId) a.approverAdminId = patch.approverAdminId;
    if (patch.reauthRef !== null && patch.reauthRef !== undefined) a.reauthRef = patch.reauthRef;
    if (patch.failureReason !== null && patch.failureReason !== undefined) a.failureReason = patch.failureReason;
    a.updatedAt = new Date().toISOString();
    return { ...a };
  }

  async sumExecutedAdjustmentsToday(userId) {
    return Array.from(this.adjustments.values())
      .filter((a) => a.userId === userId && a.status === "executed")
      .reduce((s, a) => s + a.amountCnyMinor, 0);
  }

  async executeAdjustment({ adjustmentId, approverAdminId }) {
    const a = this.adjustments.get(adjustmentId);
    if (!a) return { adjustment: null };
    if (a.status === "executed") return { adjustment: { ...a }, replay: true };
    if (!["pending_review", "approved"].includes(a.status)) { const e = new Error("state"); e.code = "ADJUSTMENT_STATE"; throw e; }
    const amount = a.amountCnyMinor;
    const entries = a.direction === "credit"
      ? [{ account: "external:adjustment", direction: "debit", amountMinor: amount }, { account: `user:${a.userId}:available`, direction: "credit", amountMinor: amount }]
      : [{ account: `user:${a.userId}:available`, direction: "debit", amountMinor: amount }, { account: "external:adjustment", direction: "credit", amountMinor: amount }];
    let post;
    try {
      post = await this.postTransaction({
        userId: a.userId, txNo: generateBusinessNumber("LTX"), type: `adjust_${a.direction}`, amountCnyMinor: amount,
        businessType: "adjustment", businessRef: a.id, idempotencyKey: `adjust:${a.id}`,
        initiatorType: "admin", initiatorId: a.initiatorAdminId, approverAdminId: approverAdminId || null, entries
      });
    } catch (err) {
      if (err.code === "WALLET_INSUFFICIENT") {
        a.status = "execution_failed"; a.approverAdminId = approverAdminId || null; a.failureReason = "insufficient_balance";
        a.updatedAt = new Date().toISOString();
        return { adjustment: { ...a }, failed: true };
      }
      throw err;
    }
    a.status = "executed"; a.approverAdminId = approverAdminId || null; a.executionTxId = post.transaction.id;
    a.updatedAt = new Date().toISOString();
    return { adjustment: { ...a }, replay: false };
  }

  async createWithdrawalWithFreeze({ withdrawalNo, userId, amountMinor, source, payeeRef }) {
    const post = await this.postTransaction({
      userId, txNo: generateBusinessNumber("LTX"), type: "withdrawal_freeze", amountCnyMinor: amountMinor,
      businessType: "withdrawal", initiatorType: "user", initiatorId: userId,
      entries: [
        { account: `user:${userId}:available`, direction: "debit", amountMinor },
        { account: `user:${userId}:frozen`, direction: "credit", amountMinor }
      ]
    });
    const now = new Date().toISOString();
    const w = {
      id: randomUUID(), withdrawalNo, userId, amountCnyMinor: amountMinor, source: source || "original_route",
      payeeRef: payeeRef || "", status: "pending_review", freezeTxId: post.transaction.id, settleTxId: null,
      unfreezeTxId: null, reviewerAdminId: null, reason: "", failureReason: "", createdAt: now, updatedAt: now
    };
    this.withdrawals.set(w.id, w);
    return { withdrawal: { ...w } };
  }

  async findWithdrawal(id) {
    const w = this.withdrawals.get(id);
    return w ? { ...w } : null;
  }

  async listWithdrawals(userId, limit = 50) {
    return Array.from(this.withdrawals.values())
      .filter((w) => w.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit).map((w) => ({ ...w }));
  }

  async markWithdrawal(id, patch) {
    const w = this.withdrawals.get(id);
    if (!w) return null;
    if (patch.status) w.status = patch.status;
    if (patch.reviewerAdminId) w.reviewerAdminId = patch.reviewerAdminId;
    if (patch.reason !== null && patch.reason !== undefined) w.reason = patch.reason;
    if (patch.failureReason !== null && patch.failureReason !== undefined) w.failureReason = patch.failureReason;
    w.updatedAt = new Date().toISOString();
    return { ...w };
  }

  async executeWithdrawal({ withdrawalId, reviewerAdminId }) {
    const w = this.withdrawals.get(withdrawalId);
    if (!w) return { withdrawal: null };
    if (w.status === "succeeded") return { withdrawal: { ...w }, replay: true };
    if (w.status !== "processing") { const e = new Error("state"); e.code = "WITHDRAWAL_STATE"; throw e; }
    const post = await this.postTransaction({
      userId: w.userId, txNo: generateBusinessNumber("LTX"), type: "withdrawal_settle", amountCnyMinor: w.amountCnyMinor,
      businessType: "withdrawal", businessRef: w.id, idempotencyKey: `withdraw-settle:${w.id}`,
      initiatorType: "admin", initiatorId: reviewerAdminId || null,
      entries: [
        { account: `user:${w.userId}:frozen`, direction: "debit", amountMinor: w.amountCnyMinor },
        { account: "external:withdrawal", direction: "credit", amountMinor: w.amountCnyMinor }
      ]
    });
    w.status = "succeeded"; w.settleTxId = post.transaction.id; w.updatedAt = new Date().toISOString();
    return { withdrawal: { ...w }, replay: false };
  }

  async unfreezeWithdrawal({ withdrawalId, newStatus, reviewerAdminId, reason }) {
    const w = this.withdrawals.get(withdrawalId);
    if (!w) return { withdrawal: null };
    if (!["pending_review", "processing"].includes(w.status)) { const e = new Error("state"); e.code = "WITHDRAWAL_STATE"; throw e; }
    const post = await this.postTransaction({
      userId: w.userId, txNo: generateBusinessNumber("LTX"), type: "withdrawal_unfreeze", amountCnyMinor: w.amountCnyMinor,
      businessType: "withdrawal", businessRef: w.id, idempotencyKey: `withdraw-unfreeze:${w.id}`,
      initiatorType: "admin", initiatorId: reviewerAdminId || null,
      entries: [
        { account: `user:${w.userId}:frozen`, direction: "debit", amountMinor: w.amountCnyMinor },
        { account: `user:${w.userId}:available`, direction: "credit", amountMinor: w.amountCnyMinor }
      ]
    });
    w.status = newStatus; w.unfreezeTxId = post.transaction.id;
    if (reviewerAdminId) w.reviewerAdminId = reviewerAdminId;
    if (reason !== null && reason !== undefined) w.failureReason = reason;
    w.updatedAt = new Date().toISOString();
    return { withdrawal: { ...w } };
  }

  async setExchangeRate({ currency, cnyPerUnitMicro, adminUserId }) {
    const list = this.rates.get(currency) || [];
    list.forEach((r) => { r.active = false; });
    const rate = {
      id: randomUUID(), currency, cnyPerUnitMicro,
      version: (list.length ? Math.max(...list.map((r) => r.version)) : 0) + 1,
      active: true, createdByAdminId: adminUserId || null, createdAt: new Date().toISOString()
    };
    list.push(rate);
    this.rates.set(currency, list);
    return { ...rate };
  }

  async getActiveRate(currency) {
    if (currency === "CNY") return { currency: "CNY", cnyPerUnitMicro: 1000000, version: 0, active: true };
    const active = (this.rates.get(currency) || []).find((r) => r.active);
    return active ? { ...active } : null;
  }

  async listRates(currency = null) {
    let all = [];
    for (const list of this.rates.values()) all = all.concat(list);
    if (currency) all = all.filter((r) => r.currency === currency);
    return all.sort((a, b) => a.currency.localeCompare(b.currency) || b.version - a.version).map((r) => ({ ...r }));
  }

  async createTopUp(input) {
    const now = new Date().toISOString();
    const top = {
      id: randomUUID(), topUpNo: input.topUpNo, userId: input.userId, provider: input.provider,
      channel: input.channel || "", originalCurrency: input.originalCurrency || "CNY",
      originalAmountMinor: input.originalAmountMinor, feeCnyMinor: input.feeCnyMinor || 0,
      cnyCreditedMinor: input.cnyCreditedMinor, rateMicroSnapshot: input.rateMicroSnapshot,
      systemStatus: "created", channelStatus: "", providerTxnId: input.providerTxnId || null,
      verifyResult: "", riskTags: [], ledgerTxId: null, idempotencyKey: input.idempotencyKey || null,
      createdAt: now, updatedAt: now
    };
    this.topUps.set(top.id, top);
    return { ...top };
  }

  async findTopUpById(id) {
    const t = this.topUps.get(id);
    return t ? { ...t } : null;
  }

  async findTopUpByIdempotency(userId, key) {
    if (!key) return null;
    for (const t of this.topUps.values()) if (t.userId === userId && t.idempotencyKey === key) return { ...t };
    return null;
  }

  async findTopUpByProviderTxn(provider, txn) {
    for (const t of this.topUps.values()) if (t.provider === provider && t.providerTxnId === txn) return { ...t };
    return null;
  }

  async listTopUps(userId, limit = 50) {
    return Array.from(this.topUps.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async markTopUp(id, patch) {
    const t = this.topUps.get(id);
    if (!t) return null;
    if (patch.systemStatus) t.systemStatus = patch.systemStatus;
    if (patch.channelStatus !== null && patch.channelStatus !== undefined) t.channelStatus = patch.channelStatus;
    if (patch.providerTxnId !== null && patch.providerTxnId !== undefined) t.providerTxnId = patch.providerTxnId;
    if (patch.verifyResult !== null && patch.verifyResult !== undefined) t.verifyResult = patch.verifyResult;
    t.updatedAt = new Date().toISOString();
    return { ...t };
  }

  async settleTopUp({ topUpId, channelStatus, verifyResult }) {
    const t = this.topUps.get(topUpId);
    if (!t) return { topUp: null };
    if (t.systemStatus === "succeeded") return { topUp: { ...t }, replay: true };
    const post = await this.postTransaction({
      userId: t.userId, txNo: generateBusinessNumber("LTX"), type: "top_up",
      amountCnyMinor: t.cnyCreditedMinor, businessType: "top_up", businessRef: t.id,
      idempotencyKey: `topup:${t.id}`, initiatorType: "user", initiatorId: t.userId,
      entries: [
        { account: "external:provider", direction: "debit", amountMinor: t.cnyCreditedMinor },
        { account: `user:${t.userId}:available`, direction: "credit", amountMinor: t.cnyCreditedMinor }
      ]
    });
    t.systemStatus = "succeeded";
    if (channelStatus) t.channelStatus = channelStatus;
    if (verifyResult) t.verifyResult = verifyResult;
    t.ledgerTxId = post.transaction.id;
    t.updatedAt = new Date().toISOString();
    return { topUp: { ...t }, transaction: post.transaction, replay: false };
  }

  _wallet(userId) {
    if (!this.wallets.has(userId)) {
      this.wallets.set(userId, { id: randomUUID(), userId, availableCnyMinor: 0, frozenCnyMinor: 0, version: 0 });
    }
    return this.wallets.get(userId);
  }

  async getWallet(userId) {
    const w = this.wallets.get(userId);
    return w ? { ...w } : null;
  }

  async findTransactionByIdempotencyKey(key) {
    if (!key || !this.byIdem.has(key)) return null;
    const id = this.byIdem.get(key);
    const rec = this.records.find((r) => r.tx.id === id);
    return rec ? { ...rec.tx } : null;
  }

  async listTransactions(userId, limit = 50) {
    const accts = [`user:${userId}:available`, `user:${userId}:frozen`];
    return this.records
      .filter((r) => r.entries.some((e) => accts.includes(e.account)))
      .slice().reverse().slice(0, limit)
      .map((r) => ({ ...r.tx }));
  }

  async recomputeBalance(userId) {
    let available = 0;
    let frozen = 0;
    for (const r of this.records) {
      if (r.tx.status !== "posted") continue;
      for (const e of r.entries) {
        const signed = e.direction === "credit" ? e.amountMinor : -e.amountMinor;
        if (e.account === `user:${userId}:available`) available += signed;
        if (e.account === `user:${userId}:frozen`) frozen += signed;
      }
    }
    return { availableCnyMinor: available, frozenCnyMinor: frozen };
  }

  async postTransaction(input) {
    const { userId, entries } = input;
    assertBalanced(entries);
    if (input.idempotencyKey && this.byIdem.has(input.idempotencyKey)) {
      const rec = this.records.find((r) => r.tx.id === this.byIdem.get(input.idempotencyKey));
      return { transaction: { ...rec.tx }, wallet: { ...this._wallet(userId) }, replay: true };
    }
    const { availableDelta, frozenDelta } = walletDeltas(userId, entries);
    const w = this._wallet(userId);
    const newAvailable = w.availableCnyMinor + availableDelta;
    const newFrozen = w.frozenCnyMinor + frozenDelta;
    if (newAvailable < 0 || newFrozen < 0) {
      const error = new Error("Insufficient wallet balance.");
      error.code = "WALLET_INSUFFICIENT";
      throw error;
    }
    const now = new Date().toISOString();
    const tx = {
      id: randomUUID(), txNo: input.txNo, type: input.type, status: "posted",
      businessType: input.businessType || "", businessRef: input.businessRef || null,
      idempotencyKey: input.idempotencyKey || null, currency: input.currency || "CNY",
      amountCnyMinor: input.amountCnyMinor, initiatorType: input.initiatorType || "system",
      initiatorId: input.initiatorId || null, approverAdminId: input.approverAdminId || null,
      reversesTxId: input.reversesTxId || null, createdAt: now, postedAt: now
    };
    this.records.push({ tx, entries: entries.map((e) => ({ ...e })) });
    if (input.idempotencyKey) this.byIdem.set(input.idempotencyKey, tx.id);
    w.availableCnyMinor = newAvailable;
    w.frozenCnyMinor = newFrozen;
    w.version += 1;
    return { transaction: { ...tx }, wallet: { ...w }, replay: false };
  }
}
