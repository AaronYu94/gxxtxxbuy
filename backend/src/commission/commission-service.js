import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { acct, PLATFORM_POOL } from "./commission-repository.js";

// V2-11-06/07/08/09 — commission wallet, signed-parcel commission, promoter privacy
// view, and commission→balance transfer.
export function createCommissionService({ repository, referralService = null, financeService = null, auditLogger = null } = {}) {
  if (!repository) throw new Error("Commission repository is required.");

  return {
    // ---- V2-11-07 generate commission when a parcel is signed ----
    // Only signed parcels generate; deduplicated by the parcel (logistics / user /
    // back-office confirmations all key off the same idempotency key). The rate,
    // base, and tier are snapshotted onto the transaction.
    async generateOnSigned({ parcelId, inviteeUserId, baseMinor }) {
      const base = Math.max(0, Math.trunc(baseMinor || 0));
      if (!referralService || base <= 0) return { generated: false, reason: base <= 0 ? "no_base" : "no_referral" };
      const promoterId = await referralService.inviterOf(inviteeUserId);
      if (!promoterId) return { generated: false, reason: "no_promoter" };

      // Accrue the promoter's effective amount first (drives their level).
      await referralService.accrueEffective(promoterId, { amountMinor: base, businessRef: parcelId, idempotencyKey: `eff:signed:${parcelId}` });
      const level = await referralService.getPromoterLevel(promoterId);
      const commission = Math.floor(base * level.commission_bps / 10000);
      if (commission <= 0) return { generated: false, reason: "zero_commission" };

      const comNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission);
      const res = await repository.post({
        comNo, promoterUserId: promoterId, inviteeUserId, businessType: "signed_commission", businessRef: parcelId,
        idempotencyKey: `signed:${parcelId}`, amountMinor: commission, baseMinor: base, commissionBps: level.commission_bps, tierLevel: level.level,
        entries: [
          { account: PLATFORM_POOL, direction: "debit", amountMinor: commission },
          { account: acct(promoterId, "available"), direction: "credit", amountMinor: commission }
        ]
      });
      await auditLogger?.write?.({ actorType: "system", action: "commission.generate", resourceType: "commission_transaction", resourceId: res.transaction.id, metadata: { promoter: promoterId, parcel: parcelId, amount: commission } }, { critical: false }).catch(() => {});
      return { generated: res.created, commission_cny_minor: commission, promoter_user_id: promoterId, tier_level: level.level, commission_bps: level.commission_bps };
    },

    // ---- V2-11-06 commission wallet ----
    async getWallet(user) {
      const w = await repository.wallet(user.id);
      return { wallet: { pending_cny_minor: w.pending, available_cny_minor: w.available, frozen_cny_minor: w.frozen, settled_cny_minor: w.settled } };
    },
    async listTransactions(user) {
      const rows = await repository.listTransactions(user.id);
      return { transactions: rows.map(publicTx) };
    },
    // Balance recompute check (for tests / integrity monitors).
    async ledgerBalances(userId) { return repository.wallet(userId); },

    // ---- V2-11-08 promoter privacy dashboard (aggregate + masked only) ----
    // Never returns per-invitee amounts, products, addresses, QC, or parcel contents.
    async getPromoterDashboard(user, userLookup = null) {
      const [wallet, level, invitees] = await Promise.all([
        repository.wallet(user.id),
        referralService ? referralService.getPromoterLevel(user.id) : null,
        referralService ? referralService.listInviteesMasked(user.id, userLookup) : { invitees: [], count: 0 }
      ]);
      return {
        invitee_count: invitees.count,
        // "Paid active" is an aggregate count only (never which invitee / how much).
        paid_active_count: invitees.invitees.filter((i) => i.paid_active).length,
        level: level ? { level: level.level, tier_code: level.tier_code, commission_bps: level.commission_bps, to_next_cny_minor: level.to_next_cny_minor } : null,
        commission_wallet: { available_cny_minor: wallet.available, pending_cny_minor: wallet.pending, frozen_cny_minor: wallet.frozen, settled_cny_minor: wallet.settled },
        // Masked invitee list — email masked, bound date only.
        invitees: invitees.invitees
      };
    },

    // ---- V2-11-09 transfer commission → normal wallet (zero-fee, idempotent) ----
    // Only the owner; only available (frozen cannot transfer). The commission ledger
    // records the debit; the normal wallet credit uses the commission transaction as
    // its idempotency key, so a retry after a partial failure converges exactly-once.
    async transferToBalance(user, input, requestMeta = {}) {
      if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });
      const amount = Math.trunc(Number(input?.amount_cny_minor));
      if (!Number.isInteger(amount) || amount <= 0) throw badRequest("amount_cny_minor must be a positive integer.", { field: "amount_cny_minor" });
      const key = requiredText(input?.idempotency_key, "idempotency_key", 120);
      // Idempotent replay: if this transfer already posted, return it without
      // re-checking the (now-reduced) available balance.
      const priorKey = `transfer:${user.id}:${key}`;
      const prior = await repository.findByIdempotencyKey(priorKey);
      if (prior) {
        if (financeService) await financeService.credit(user.id, prior.amountMinor, { type: "commission_transfer", businessType: "commission", businessRef: prior.id, idempotencyKey: `comtransfer:${prior.id}` }).catch(() => {});
        return { transferred: false, amount_cny_minor: prior.amountMinor, wallet: await this._publicWallet(user.id) };
      }
      const wallet = await repository.wallet(user.id);
      if (amount > wallet.available) throw conflict("Insufficient available commission (frozen amounts cannot transfer).", { code: "insufficient_available", available: wallet.available });

      const comNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission);
      const posted = await repository.post({
        comNo, promoterUserId: user.id, inviteeUserId: null, businessType: "transfer_out", businessRef: key,
        idempotencyKey: `transfer:${user.id}:${key}`, amountMinor: amount,
        entries: [
          { account: acct(user.id, "available"), direction: "debit", amountMinor: amount },
          { account: acct(user.id, "settled"), direction: "credit", amountMinor: amount }
        ]
      });
      // Credit the normal wallet (idempotent on the commission transaction id).
      await financeService.credit(user.id, amount, { type: "commission_transfer", businessType: "commission", businessRef: posted.transaction.id, idempotencyKey: `comtransfer:${posted.transaction.id}` });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "commission.transfer", resourceType: "commission_transaction", resourceId: posted.transaction.id, metadata: { amount }, requestId: requestMeta.requestId }, { critical: true });
      return { transferred: posted.created, amount_cny_minor: amount, wallet: await this._publicWallet(user.id) };
    },

    async _publicWallet(userId) {
      const w = await repository.wallet(userId);
      return { pending_cny_minor: w.pending, available_cny_minor: w.available, frozen_cny_minor: w.frozen, settled_cny_minor: w.settled };
    },

    // ---- V2-11-10 bank withdrawal (min 2000 CNY; freeze → review → pay) ----
    async requestWithdrawal(user, input, requestMeta = {}) {
      const amount = Math.trunc(Number(input?.amount_cny_minor));
      if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL_MINOR) throw badRequest(`Minimum withdrawal is ${MIN_WITHDRAWAL_MINOR / 100} CNY.`, { field: "amount_cny_minor", min_cny_minor: MIN_WITHDRAWAL_MINOR });
      const qual = await repository.getQualification(user.id);
      if (qual.status !== "active") throw conflict("Commission is frozen or disqualified.", { code: "not_active", status: qual.status });
      const wallet = await repository.wallet(user.id);
      if (amount > wallet.available) throw conflict("Insufficient available commission.", { code: "insufficient_available", available: wallet.available });
      // The bank card is referenced, never stored raw here.
      const bankAccountRef = requiredText(input?.bank_account_ref, "bank_account_ref", 200);
      const bankLast4 = optionalText(input?.bank_last4, "bank_last4", 4);

      const key = requiredText(input?.idempotency_key, "idempotency_key", 120);
      const freeze = await repository.post({
        comNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission), promoterUserId: user.id, businessType: "withdrawal_freeze", businessRef: key,
        idempotencyKey: `wdfreeze:${user.id}:${key}`, amountMinor: amount,
        entries: [{ account: acct(user.id, "available"), direction: "debit", amountMinor: amount }, { account: acct(user.id, "frozen"), direction: "credit", amountMinor: amount }]
      });
      const wdNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.withdrawal);
      const withdrawal = await repository.createWithdrawal({ wdNo, promoterUserId: user.id, amountMinor: amount, bankAccountRef, bankLast4, freezeTxId: freeze.transaction.id, idempotencyKey: key });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "commission.withdraw_request", resourceType: "commission_withdrawal", resourceId: withdrawal.id, requestId: requestMeta.requestId }, { critical: true });
      return { withdrawal: publicWithdrawal(withdrawal) };
    },
    async listWithdrawals(query = {}) { return { withdrawals: (await repository.listWithdrawals({ status: query.status ? String(query.status) : null })).map(publicWithdrawal) }; },

    async reviewWithdrawal(adminUser, id, input, requestMeta = {}) {
      const wd = await repository.findWithdrawal(id);
      if (!wd) throw notFound("Withdrawal not found.");
      if (wd.status !== "pending_review") throw conflict("Withdrawal is not pending review.", { code: "not_pending" });
      const approve = input?.decision === "approve";
      if (approve) {
        const updated = await repository.setWithdrawalStatus({ id, fromStatus: "pending_review", toStatus: "processing", reviewerAdminId: adminUser.id });
        return { withdrawal: publicWithdrawal(updated) };
      }
      // Reject → unfreeze back to available.
      await this._unfreeze(wd);
      const updated = await repository.setWithdrawalStatus({ id, fromStatus: "pending_review", toStatus: "rejected", reviewerAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
      return { withdrawal: publicWithdrawal(updated) };
    },
    async payWithdrawal(adminUser, id, requestMeta = {}) {
      const wd = await repository.findWithdrawal(id);
      if (!wd) throw notFound("Withdrawal not found.");
      if (wd.status === "succeeded") return { withdrawal: publicWithdrawal(wd) }; // idempotent — no double payment
      if (wd.status !== "processing") throw conflict("Withdrawal is not processing.", { code: "not_processing" });
      // Settle: frozen → settled (paid out). Idempotent per withdrawal.
      const settle = await repository.post({
        comNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission), promoterUserId: wd.promoterUserId, businessType: "withdrawal_settle", businessRef: wd.id,
        idempotencyKey: `wdsettle:${wd.id}`, amountMinor: wd.amountMinor,
        entries: [{ account: acct(wd.promoterUserId, "frozen"), direction: "debit", amountMinor: wd.amountMinor }, { account: acct(wd.promoterUserId, "settled"), direction: "credit", amountMinor: wd.amountMinor }]
      });
      const updated = await repository.setWithdrawalStatus({ id, fromStatus: "processing", toStatus: "succeeded", reviewerAdminId: adminUser.id, settleTxId: settle.transaction.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "commission.withdraw_paid", resourceType: "commission_withdrawal", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { withdrawal: publicWithdrawal(updated) };
    },
    async failWithdrawal(adminUser, id, input, requestMeta = {}) {
      const wd = await repository.findWithdrawal(id);
      if (!wd) throw notFound("Withdrawal not found.");
      if (wd.status !== "processing") throw conflict("Withdrawal is not processing.", { code: "not_processing" });
      await this._unfreeze(wd); // failure unfreezes back to available
      const updated = await repository.setWithdrawalStatus({ id, fromStatus: "processing", toStatus: "failed", reviewerAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
      return { withdrawal: publicWithdrawal(updated) };
    },
    async _unfreeze(wd) {
      await repository.post({
        comNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission), promoterUserId: wd.promoterUserId, businessType: "withdrawal_unfreeze", businessRef: wd.id,
        idempotencyKey: `wdunfreeze:${wd.id}`, amountMinor: wd.amountMinor,
        entries: [{ account: acct(wd.promoterUserId, "frozen"), direction: "debit", amountMinor: wd.amountMinor }, { account: acct(wd.promoterUserId, "available"), direction: "credit", amountMinor: wd.amountMinor }]
      });
    },

    // ---- V2-11-11 freeze / unfreeze / disqualify (reason + evidence mandatory) ----
    async discipline(adminUser, adminRoles, input, requestMeta = {}) {
      const promoterId = requiredText(input?.promoter_user_id, "promoter_user_id", 64);
      const action = input?.action;
      if (!["freeze", "unfreeze", "disqualify"].includes(action)) throw badRequest("action must be freeze/unfreeze/disqualify.", { field: "action" });
      const reason = requiredText(input?.reason, "reason", 500);
      const evidence = Array.isArray(input?.evidence) ? input.evidence.map(String).filter(Boolean) : [];
      if (action !== "unfreeze" && evidence.length === 0) throw badRequest("Evidence is required.", { field: "evidence" });
      if (action === "disqualify" && input?.confirm !== true) throw badRequest("Disqualification requires explicit confirmation.", { code: "confirm_required" });

      const status = action === "unfreeze" ? "active" : (action === "freeze" ? "frozen" : "disqualified");
      const qual = await repository.setQualification({ promoterUserId: promoterId, status, reason });
      await repository.addDisciplinaryRecord({ promoterUserId: promoterId, action, reason, evidence, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: `commission.${action}`, resourceType: "user", resourceId: promoterId, requestId: requestMeta.requestId }, { critical: true });
      return { qualification: qual };
    },

    // ---- V2-11-12 refund dispute clawback (once, ≤ original, negative-capable) ----
    async clawbackForRefund({ parcelId, refundRef }) {
      const originals = await repository.findByBusinessRef("signed_commission", parcelId);
      const original = originals[0];
      if (!original) return { clawed: false, reason: "no_commission" };
      const promoterId = original.promoterUserId;
      // Also claw back the promoter's effective amount.
      if (referralService) await referralService.clawbackEffective(promoterId, { amountMinor: original.baseMinor, businessRef: parcelId, idempotencyKey: `effclaw:signed:${parcelId}` });
      // Debit available (may go negative — traceable), credit the platform pool.
      const res = await repository.post({
        comNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.commission), promoterUserId: promoterId, businessType: "refund_clawback", businessRef: refundRef || parcelId,
        idempotencyKey: `claw:${parcelId}`, amountMinor: original.amountMinor,
        entries: [{ account: acct(promoterId, "available"), direction: "debit", amountMinor: original.amountMinor }, { account: PLATFORM_POOL, direction: "credit", amountMinor: original.amountMinor }]
      });
      return { clawed: res.created, amount_cny_minor: original.amountMinor, promoter_user_id: promoterId };
    }
  };
}

const MIN_WITHDRAWAL_MINOR = 200000; // 2000 CNY

export function publicTx(t) {
  return { com_no: t.comNo, business_type: t.businessType, business_ref: t.businessRef, amount_cny_minor: t.amountMinor, base_cny_minor: t.baseMinor, commission_bps: t.commissionBps, tier_level: t.tierLevel, status: t.status, created_at: t.createdAt };
}
export function publicWithdrawal(w) {
  // Only the last-4 of the bank card is ever surfaced (the ref stays isolated).
  return { id: w.id, wd_no: w.wdNo, amount_cny_minor: w.amountMinor, bank_last4: w.bankLast4, status: w.status, decision_reason: w.decisionReason, created_at: w.createdAt };
}
