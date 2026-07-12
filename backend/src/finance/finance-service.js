import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { optionalText, requiredText } from "../core/core-input.js";

// V2-05-02 — semantic money primitives over the double-entry ledger. Each helper
// builds a balanced entry pair and posts it atomically; higher tasks (order
// debit, surcharge, refund, withdrawal, adjustment) compose these. All amounts
// are integer CNY minor units.
export const LEDGER_ACCOUNTS = Object.freeze({
  provider: "external:provider",
  platform: "external:platform",
  withdrawal: "external:withdrawal",
  adjustment: "external:adjustment"
});

export function createFinanceService({ repository, auditLogger = null, paymentProvider = null, orderService = null, clock = () => Date.now(), env = {} } = {}) {
  if (!repository) {
    throw new Error("Finance repository is required.");
  }

  const acct = (userId, bucket) => `user:${userId}:${bucket}`;

  async function post(userId, options) {
    let result;
    try {
      result = await repository.postTransaction({
        userId,
        txNo: generateBusinessNumber("LTX"),
        type: options.type,
        amountCnyMinor: options.amountMinor,
        entries: options.entries,
        businessType: options.businessType,
        businessRef: options.businessRef,
        idempotencyKey: options.idempotencyKey,
        initiatorType: options.initiatorType,
        initiatorId: options.initiatorId,
        approverAdminId: options.approverAdminId,
        reversesTxId: options.reversesTxId
      });
    } catch (error) {
      if (error.code === "WALLET_INSUFFICIENT") {
        throw conflict("Insufficient wallet balance.", { code: "insufficient_balance" });
      }
      throw error;
    }
    return result;
  }

  return {
    async getBalance(userId) {
      const wallet = (await repository.getWallet(userId)) || { availableCnyMinor: 0, frozenCnyMinor: 0, version: 0 };
      return { wallet: publicWallet(wallet) };
    },

    async listTransactions(userId) {
      const transactions = await repository.listTransactions(userId);
      return { transactions: transactions.map(publicTransaction) };
    },

    async recompute(userId) {
      return repository.recomputeBalance(userId);
    },

    // ---- V2-05-03 exchange rates (admin) ----
    async setExchangeRate(adminUser, input, requestMeta = {}) {
      const currency = requiredText(input?.currency, "currency", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw badRequest("currency must be a 3-letter code.", { field: "currency" });
      }
      const perUnit = Number(input?.cny_per_unit);
      if (!Number.isFinite(perUnit) || perUnit <= 0) {
        throw badRequest("cny_per_unit must be greater than 0.", { field: "cny_per_unit" });
      }
      const rate = await repository.setExchangeRate({
        currency, cnyPerUnitMicro: Math.round(perUnit * 1000000), adminUserId: adminUser.id
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.exchange_rate_set",
        resourceType: "exchange_rate", resourceId: rate.id, metadata: { currency, version: rate.version },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { rate: publicRate(rate) };
    },

    async listExchangeRates(currency) {
      const rates = await repository.listRates(currency ? String(currency).toUpperCase() : null);
      return { rates: rates.map(publicRate) };
    },

    // ---- V2-05-06 create top-up ----
    async createTopUp(user, input, requestMeta = {}) {
      if (!paymentProvider) {
        throw conflict("Payment is not configured.", { code: "not_configured" });
      }
      const currency = (optionalText(input?.currency, "currency", 3) || "CNY").toUpperCase();
      const amount = Number(input?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw badRequest("amount must be greater than 0.", { field: "amount" });
      }
      const originalAmountMinor = Math.round(amount * 100);
      const channel = optionalText(input?.channel, "channel", 40);
      const key = optionalText(input?.idempotency_key, "idempotency_key", 120);
      if (key) {
        const existing = await repository.findTopUpByIdempotency(user.id, key);
        if (existing) return { top_up: publicTopUp(existing), existing: true };
      }

      const rate = await repository.getActiveRate(currency);
      if (!rate) {
        throw badRequest("No exchange rate is configured for this currency.", { field: "currency" });
      }
      const convertedCny = Math.floor(originalAmountMinor * rate.cnyPerUnitMicro / 1000000);
      const feeBps = Number(env.topUpFeeBps) || 0;
      const feeCny = Math.floor(convertedCny * feeBps / 10000);
      const cnyCredited = convertedCny - feeCny;
      if (cnyCredited < 1000) {
        throw badRequest("A top-up must credit at least 10 CNY.", { field: "amount", min_cny_minor: 1000 });
      }

      const topUpNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.topUp);
      let charge;
      try {
        charge = await paymentProvider.createCharge({ topUpNo, amountMinor: originalAmountMinor, currency, channel });
      } catch (error) {
        if (error.code === "PROVIDER_NOT_CONFIGURED") throw conflict("Payment is not configured.", { code: "not_configured" });
        throw error;
      }

      const top = await repository.createTopUp({
        topUpNo, userId: user.id, provider: paymentProvider.name, channel, originalCurrency: currency,
        originalAmountMinor, feeCnyMinor: feeCny, cnyCreditedMinor: cnyCredited,
        rateMicroSnapshot: rate.cnyPerUnitMicro, providerTxnId: charge.providerTxnId, idempotencyKey: key || null
      });
      const pending = await repository.markTopUp(top.id, { systemStatus: "pending_provider", channelStatus: charge.channelStatus });
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "finance.top_up_create",
        resourceType: "top_up", resourceId: top.id, metadata: { cny_credited_minor: cnyCredited },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { top_up: publicTopUp(pending), redirect_url: charge.redirectUrl, existing: false };
    },

    // ---- V2-05-07 webhook: verify + idempotent settle ----
    async handlePaymentWebhook({ body, signature }) {
      if (!paymentProvider) throw conflict("Payment is not configured.", { code: "not_configured" });
      const { valid, event } = paymentProvider.verifyWebhook({ body, signature });
      if (!valid || !event) {
        throw badRequest("Invalid webhook signature.");
      }
      const top = await repository.findTopUpByProviderTxn(paymentProvider.name, event.providerTxnId);
      if (!top) {
        throw notFound("Top-up not found for this transaction.");
      }
      // Verify amount + currency + user match before crediting anything.
      if (Number(event.amountMinor) !== top.originalAmountMinor || event.currency !== top.originalCurrency) {
        await repository.markTopUp(top.id, { systemStatus: "exception", channelStatus: event.status, verifyResult: "amount_or_currency_mismatch" });
        throw conflict("Webhook amount or currency mismatch.", { code: "mismatch" });
      }
      if (event.status === "succeeded" || event.status === "paid") {
        const res = await repository.settleTopUp({ topUpId: top.id, channelStatus: event.status, verifyResult: "ok" });
        return { top_up: publicTopUp(res.topUp), settled: !res.replay };
      }
      if (event.status === "failed" || event.status === "cancelled") {
        const updated = await repository.markTopUp(top.id, { systemStatus: "failed", channelStatus: event.status, verifyResult: "ok" });
        return { top_up: publicTopUp(updated), settled: false };
      }
      const updated = await repository.markTopUp(top.id, { channelStatus: event.status });
      return { top_up: publicTopUp(updated), settled: false };
    },

    async listTopUps(user) {
      const topUps = await repository.listTopUps(user.id);
      return { top_ups: topUps.map(publicTopUp) };
    },

    // ---- V2-05-10 — shortfall preview so the UI can offer a top-up ----
    async getOrderPaymentPreview(user, parentId) {
      requireOrderService(orderService);
      const { order } = await orderService.getOrder(user, parentId);
      const wallet = (await repository.getWallet(user.id)) || { availableCnyMinor: 0 };
      const total = order.items_total_cents;
      const available = wallet.availableCnyMinor;
      return {
        payable: order.payment_status === "unpaid",
        total_cny_minor: total,
        available_cny_minor: available,
        shortfall_cny_minor: Math.max(0, total - available)
      };
    },

    // ---- V2-05-09 — pay a parent order from the wallet ----
    async payOrder(user, parentId, requestMeta = {}) {
      requireOrderService(orderService);
      const { order } = await orderService.getOrder(user, parentId);
      if (order.payment_status !== "unpaid") {
        // Already paid → idempotent success (never a second debit).
        return { order, wallet: publicWallet((await repository.getWallet(user.id)) || zeroWallet()) };
      }
      const amount = order.items_total_cents;
      // One debit per parent order (idempotency key), refuse partial on shortfall.
      const debit = await post(user.id, {
        type: "order_payment", amountMinor: amount,
        businessType: "order", businessRef: parentId, idempotencyKey: `order:${parentId}`,
        initiatorType: "user", initiatorId: user.id,
        entries: [
          { account: `user:${user.id}:available`, direction: "debit", amountMinor: amount },
          { account: LEDGER_ACCOUNTS.platform, direction: "credit", amountMinor: amount }
        ]
      });
      const paid = await orderService.markPaidAndAssign({ type: "user", id: user.id }, parentId, { eventId: `order:${parentId}` });
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "finance.order_payment",
        resourceType: "order_parent", resourceId: parentId, metadata: { amount_cny_minor: amount },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { order: paid.order, wallet: publicWallet(debit.wallet) };
    },

    // ---- V2-05-11 — pay a price-increase surcharge from the wallet ----
    async paySurcharge(user, itemId, requestMeta = {}) {
      requireOrderService(orderService);
      const { exception } = await orderService.getItemException(user, itemId);
      if (!exception || exception.type !== "price_increase") {
        throw conflict("No payable surcharge on this item.");
      }
      if (clock() > Date.parse(exception.deadline_at)) {
        throw conflict("This surcharge has expired and can no longer be paid.");
      }
      const amount = exception.surcharge_cents;
      await post(user.id, {
        type: "surcharge_payment", amountMinor: amount,
        businessType: "surcharge", businessRef: exception.id, idempotencyKey: `surcharge:${exception.id}`,
        initiatorType: "user", initiatorId: user.id,
        entries: [
          { account: `user:${user.id}:available`, direction: "debit", amountMinor: amount },
          { account: LEDGER_ACCOUNTS.platform, direction: "credit", amountMinor: amount }
        ]
      });
      // Now clear the exception so procurement continues.
      const resolved = await orderService.respondException(user, itemId, { choice: "pay_surcharge" });
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "finance.surcharge_payment",
        resourceType: "item_order", resourceId: itemId, metadata: { amount_cny_minor: amount },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { item: resolved.item, wallet: publicWallet((await repository.getWallet(user.id)) || zeroWallet()) };
    },

    // ---- V2-05-12 — generic idempotent refund for a business object ----
    // ---- V2-05-13 request a withdrawal (freezes immediately) ----
    async requestWithdrawal(user, input, requestMeta = {}) {
      const amount = Number(input?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw badRequest("amount must be greater than 0.", { field: "amount" });
      }
      const amountMinor = Math.round(amount * 100);
      // Only original-route refunds; the payee reference is fixed here.
      const payeeRef = optionalText(input?.payee_ref, "payee_ref", 240);
      let result;
      try {
        result = await repository.createWithdrawalWithFreeze({
          withdrawalNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.withdrawal),
          userId: user.id, amountMinor, source: "original_route", payeeRef
        });
      } catch (error) {
        if (error.code === "WALLET_INSUFFICIENT") throw conflict("Insufficient balance to withdraw.", { code: "insufficient_balance" });
        throw error;
      }
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "finance.withdrawal_request",
        resourceType: "withdrawal", resourceId: result.withdrawal.id, metadata: { amount_cny_minor: amountMinor },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { withdrawal: publicWithdrawal(result.withdrawal) };
    },

    async listWithdrawals(user) {
      const rows = await repository.listWithdrawals(user.id);
      return { withdrawals: rows.map(publicWithdrawal) };
    },

    // ---- V2-05-14 review + execute ----
    async reviewWithdrawal(adminUser, id, input, requestMeta = {}) {
      const w = await repository.findWithdrawal(id);
      if (!w) throw notFound("Withdrawal not found.");
      if (w.status !== "pending_review") throw conflict("Withdrawal is not pending review.");
      const decision = requiredText(input?.decision, "decision", 20);
      let updated;
      if (decision === "approve") {
        updated = await repository.markWithdrawal(id, { status: "processing", reviewerAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
      } else if (decision === "reject") {
        const res = await repository.unfreezeWithdrawal({ withdrawalId: id, newStatus: "rejected", reviewerAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
        updated = res.withdrawal;
      } else {
        throw badRequest("decision must be approve or reject.", { field: "decision" });
      }
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: `finance.withdrawal_${decision}`,
        resourceType: "withdrawal", resourceId: id, requestId: requestMeta.requestId
      }, { critical: true });
      return { withdrawal: publicWithdrawal(updated) };
    },

    async executeWithdrawal(adminUser, id, requestMeta = {}) {
      const w = await repository.findWithdrawal(id);
      if (!w) throw notFound("Withdrawal not found.");
      let result;
      try {
        result = await repository.executeWithdrawal({ withdrawalId: id, reviewerAdminId: adminUser.id });
      } catch (error) {
        if (error.code === "WITHDRAWAL_STATE") throw conflict("Withdrawal is not in processing.");
        throw error;
      }
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.withdrawal_execute",
        resourceType: "withdrawal", resourceId: id, metadata: { replay: Boolean(result.replay) },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { withdrawal: publicWithdrawal(result.withdrawal), replay: Boolean(result.replay) };
    },

    async failWithdrawal(adminUser, id, input, requestMeta = {}) {
      const res = await repository.unfreezeWithdrawal({
        withdrawalId: id, newStatus: "failed", reviewerAdminId: adminUser.id,
        reason: optionalText(input?.reason, "reason", 500)
      });
      if (!res.withdrawal) throw notFound("Withdrawal not found.");
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.withdrawal_fail",
        resourceType: "withdrawal", resourceId: id, requestId: requestMeta.requestId
      }, { critical: true });
      return { withdrawal: publicWithdrawal(res.withdrawal) };
    },

    // ---- V2-05-15 create an adjustment request (finance initiates) ----
    async createAdjustment(adminUser, input, requestMeta = {}) {
      const direction = input?.direction === "debit" ? "debit" : (input?.direction === "credit" ? "credit" : null);
      if (!direction) throw badRequest("direction must be credit or debit.", { field: "direction" });
      const userId = requiredText(input?.user_id, "user_id", 64);
      const amount = Number(input?.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amount must be greater than 0.", { field: "amount" });
      const amountMinor = Math.round(amount * 100);
      const reason = requiredText(input?.reason, "reason", 500);

      const singleLimit = Number(env.adjustSingleLimitMinor) || 1000000; // 10,000 CNY
      const dailyLimit = Number(env.adjustDailyLimitMinor) || 5000000;   // 50,000 CNY
      if (amountMinor > singleLimit) {
        throw badRequest("Adjustment exceeds the single-transaction limit.", { field: "amount", limit_cny_minor: singleLimit });
      }
      const usedToday = await repository.sumExecutedAdjustmentsToday(userId);
      if (usedToday + amountMinor > dailyLimit) {
        throw conflict("Adjustment exceeds the daily limit for this user.", { limit_cny_minor: dailyLimit, used_cny_minor: usedToday });
      }

      const adjustment = await repository.createAdjustment({
        adjustmentNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.adjustment),
        userId, direction, amountMinor, reason,
        evidence: Array.isArray(input?.evidence) ? input.evidence.slice(0, 10).map(String) : [],
        businessRef: optionalText(input?.business_ref, "business_ref", 120),
        initiatorAdminId: adminUser.id
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.adjustment_create",
        resourceType: "adjustment_request", resourceId: adjustment.id,
        metadata: { direction, amount_cny_minor: amountMinor }, requestId: requestMeta.requestId
      }, { critical: true });
      return { adjustment: publicAdjustment(adjustment) };
    },

    async listAdjustments() {
      const rows = await repository.listAdjustments();
      return { adjustments: rows.map(publicAdjustment) };
    },

    // ---- V2-05-16 super-admin approves (maker != checker) and executes once ----
    async approveAdjustment(adminUser, adminRoles, id, requestMeta = {}) {
      const adjustment = await repository.findAdjustment(id);
      if (!adjustment) throw notFound("Adjustment not found.");
      if (adjustment.status !== "pending_review") throw conflict("Adjustment is not pending review.");
      if (!(adminRoles || []).includes("super_admin")) {
        throw forbidden("Only a super-admin can approve an adjustment.");
      }
      // Finance cannot approve their own request.
      if (adjustment.initiatorAdminId && adjustment.initiatorAdminId === adminUser.id) {
        throw forbidden("The initiator cannot approve their own adjustment.");
      }
      const result = await repository.executeAdjustment({ adjustmentId: id, approverAdminId: adminUser.id });
      if (!result.adjustment) throw notFound("Adjustment not found.");
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.adjustment_approve",
        resourceType: "adjustment_request", resourceId: id,
        metadata: { status: result.adjustment.status, failed: Boolean(result.failed) }, requestId: requestMeta.requestId
      }, { critical: true });
      return { adjustment: publicAdjustment(result.adjustment), failed: Boolean(result.failed) };
    },

    async rejectAdjustment(adminUser, id, input, requestMeta = {}) {
      const adjustment = await repository.findAdjustment(id);
      if (!adjustment) throw notFound("Adjustment not found.");
      if (adjustment.status !== "pending_review") throw conflict("Adjustment is not pending review.");
      const updated = await repository.markAdjustment(id, {
        status: "rejected", approverAdminId: adminUser.id, failureReason: optionalText(input?.reason, "reason", 500)
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.adjustment_reject",
        resourceType: "adjustment_request", resourceId: id, requestId: requestMeta.requestId
      }, { critical: true });
      return { adjustment: publicAdjustment(updated) };
    },

    // ---- V2-05-17 top-up exception workbench ----
    async listTopUpExceptions(query = {}) {
      const statuses = query.status ? [String(query.status)] : ["failed", "expired", "exception"];
      const rows = await repository.listTopUpExceptions({
        statuses, limit: Math.min(Number(query.limit) || 50, 100), offset: Math.max(0, Number(query.offset) || 0)
      });
      return { top_ups: rows.map(publicTopUp) };
    },

    // ---- V2-05-18 reconciliation import (idempotent, never auto-adjusts) ----
    async importReconciliation(adminUser, input, requestMeta = {}) {
      const fileHash = requiredText(input?.file_hash, "file_hash", 128);
      const provider = paymentProvider?.name || "stub";
      const records = Array.isArray(input?.records) ? input.records : [];

      const existing = await repository.findReconciliationBatch(fileHash);
      if (existing) {
        const diffs = await repository.listReconciliationDiffs(existing.id);
        return { batch: publicBatch(existing), diffs: diffs.map(publicDiff), existing: true };
      }

      const usdRate = await repository.getActiveRate("USD");
      const diffs = [];
      for (const record of records) {
        const providerTxnId = String(record?.provider_txn_id || "");
        const amountMinor = Number(record?.amount_minor);
        const currency = String(record?.currency || "CNY").toUpperCase();
        const rate = await repository.getActiveRate(currency);
        const cnyMinor = rate ? Math.floor(amountMinor * rate.cnyPerUnitMicro / 1000000) : null;
        const usdMinor = usdRate && cnyMinor !== null ? Math.floor(cnyMinor * 1000000 / usdRate.cnyPerUnitMicro) : null;
        const local = await repository.findTopUpByProviderTxn(provider, providerTxnId);
        if (!local) {
          diffs.push({ providerTxnId, diffType: "missing_local", providerAmountMinor: amountMinor, localAmountMinor: null, providerCurrency: currency, cnyMinor, usdMinor });
        } else if (local.originalAmountMinor !== amountMinor) {
          diffs.push({ providerTxnId, diffType: "amount_mismatch", providerAmountMinor: amountMinor, localAmountMinor: local.originalAmountMinor, providerCurrency: currency, cnyMinor, usdMinor });
        } else if ((record?.status === "succeeded" || record?.status === "paid") && local.systemStatus !== "succeeded") {
          diffs.push({ providerTxnId, diffType: "status_mismatch", providerAmountMinor: amountMinor, localAmountMinor: local.originalAmountMinor, providerCurrency: currency, cnyMinor, usdMinor, detail: { provider_status: record.status, local_status: local.systemStatus } });
        }
      }
      const batch = await repository.createReconciliationBatch({
        fileHash, provider, importedByAdminId: adminUser.id, recordCount: records.length, diffs
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "finance.reconciliation_import",
        resourceType: "reconciliation_batch", resourceId: batch.id, metadata: { record_count: records.length, diff_count: diffs.length },
        requestId: requestMeta.requestId
      }, { critical: true });
      const stored = await repository.listReconciliationDiffs(batch.id);
      return { batch: publicBatch(batch), diffs: stored.map(publicDiff), existing: false };
    },

    async refundItem(userId, itemId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      const result = await this.refund(userId, amountMinor, {
        type: opts.type || "order_refund", businessType: opts.businessType || "item_order",
        businessRef: itemId, idempotencyKey: opts.idempotencyKey || `refund:${itemId}`,
        initiatorType: opts.initiatorType || "system", initiatorId: opts.initiatorId || null
      });
      await auditLogger?.write?.({
        actorType: opts.initiatorType || "system", action: "finance.refund",
        resourceType: "item_order", resourceId: itemId, metadata: { amount_cny_minor: amountMinor }
      }, { critical: true });
      return { wallet: publicWallet(result.wallet), replay: result.replay };
    },

    // Credit available (top-up in, refund-in from an external source).
    async credit(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "credit", amountMinor,
        entries: [
          { account: opts.source || LEDGER_ACCOUNTS.provider, direction: "debit", amountMinor },
          { account: acct(userId, "available"), direction: "credit", amountMinor }
        ]
      });
    },

    // Debit available (order / surcharge payment). Overdraw is refused.
    async debit(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "debit", amountMinor,
        entries: [
          { account: acct(userId, "available"), direction: "debit", amountMinor },
          { account: opts.sink || LEDGER_ACCOUNTS.platform, direction: "credit", amountMinor }
        ]
      });
    },

    // Move available → frozen (withdrawal request). Overdraw is refused.
    async freeze(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "freeze", amountMinor,
        entries: [
          { account: acct(userId, "available"), direction: "debit", amountMinor },
          { account: acct(userId, "frozen"), direction: "credit", amountMinor }
        ]
      });
    },

    // Move frozen → available (withdrawal rejected / failed).
    async unfreeze(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "unfreeze", amountMinor,
        entries: [
          { account: acct(userId, "frozen"), direction: "debit", amountMinor },
          { account: acct(userId, "available"), direction: "credit", amountMinor }
        ]
      });
    },

    // Settle frozen out of the wallet (withdrawal executed).
    async settleFrozen(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "withdrawal_settle", amountMinor,
        entries: [
          { account: acct(userId, "frozen"), direction: "debit", amountMinor },
          { account: opts.sink || LEDGER_ACCOUNTS.withdrawal, direction: "credit", amountMinor }
        ]
      });
    },

    // Refund back to available from an external source.
    async refund(userId, amountMinor, opts = {}) {
      requirePositive(amountMinor);
      return post(userId, {
        ...opts, type: opts.type || "refund", amountMinor,
        entries: [
          { account: opts.source || LEDGER_ACCOUNTS.platform, direction: "debit", amountMinor },
          { account: acct(userId, "available"), direction: "credit", amountMinor }
        ]
      });
    },

    // Manual adjustment (maker-checker executes this): credit or debit available.
    async adjust(userId, amountMinor, direction, opts = {}) {
      requirePositive(amountMinor);
      const entries = direction === "credit"
        ? [
            { account: LEDGER_ACCOUNTS.adjustment, direction: "debit", amountMinor },
            { account: acct(userId, "available"), direction: "credit", amountMinor }
          ]
        : [
            { account: acct(userId, "available"), direction: "debit", amountMinor },
            { account: LEDGER_ACCOUNTS.adjustment, direction: "credit", amountMinor }
          ];
      return post(userId, { ...opts, type: opts.type || `adjust_${direction}`, amountMinor, entries });
    },

    post
  };
}

function requirePositive(amountMinor) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw badRequest("Amount must be a positive integer in minor units.", { field: "amount" });
  }
}

function requireOrderService(orderService) {
  if (!orderService) {
    throw new Error("Order service is required for order payments.");
  }
}

function zeroWallet() {
  return { availableCnyMinor: 0, frozenCnyMinor: 0, version: 0 };
}

export function publicWallet(wallet) {
  return {
    available_cny_minor: wallet.availableCnyMinor,
    frozen_cny_minor: wallet.frozenCnyMinor,
    version: wallet.version
  };
}

export function publicTransaction(tx) {
  return {
    id: tx.id,
    tx_no: tx.txNo,
    type: tx.type,
    status: tx.status,
    business_type: tx.businessType,
    business_ref: tx.businessRef,
    amount_cny_minor: tx.amountCnyMinor,
    created_at: tx.createdAt
  };
}

export function publicRate(rate) {
  return {
    id: rate.id,
    currency: rate.currency,
    cny_per_unit_micro: rate.cnyPerUnitMicro,
    version: rate.version,
    active: rate.active,
    created_at: rate.createdAt
  };
}

export function publicBatch(b) {
  return {
    id: b.id,
    file_hash: b.fileHash,
    provider: b.provider,
    record_count: b.recordCount,
    diff_count: b.diffCount,
    created_at: b.createdAt
  };
}

export function publicDiff(d) {
  return {
    id: d.id,
    provider_txn_id: d.providerTxnId,
    diff_type: d.diffType,
    provider_amount_minor: d.providerAmountMinor,
    local_amount_minor: d.localAmountMinor,
    provider_currency: d.providerCurrency,
    cny_minor: d.cnyMinor,
    usd_minor: d.usdMinor
  };
}

export function publicAdjustment(a) {
  return {
    id: a.id,
    adjustment_no: a.adjustmentNo,
    user_id: a.userId,
    direction: a.direction,
    amount_cny_minor: a.amountCnyMinor,
    reason: a.reason,
    business_ref: a.businessRef,
    status: a.status,
    failure_reason: a.failureReason,
    created_at: a.createdAt
  };
}

export function publicWithdrawal(w) {
  return {
    id: w.id,
    withdrawal_no: w.withdrawalNo,
    amount_cny_minor: w.amountCnyMinor,
    source: w.source,
    status: w.status,
    reason: w.reason,
    failure_reason: w.failureReason,
    created_at: w.createdAt
  };
}

export function publicTopUp(top) {
  return {
    id: top.id,
    top_up_no: top.topUpNo,
    provider: top.provider,
    channel: top.channel,
    original_currency: top.originalCurrency,
    original_amount_minor: top.originalAmountMinor,
    fee_cny_minor: top.feeCnyMinor,
    cny_credited_minor: top.cnyCreditedMinor,
    system_status: top.systemStatus,
    channel_status: top.channelStatus,
    created_at: top.createdAt
  };
}
