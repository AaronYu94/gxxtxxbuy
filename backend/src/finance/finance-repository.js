import { getDbPool } from "../db/pool.js";
import { generateBusinessNumber } from "../core/business-number.js";

// V2-05-01/02 — CNY wallet + double-entry ledger persistence. The load-bearing
// primitive is postTransaction: it validates that entries balance, then in ONE
// locked transaction writes the immutable ledger rows AND moves the wallet's
// available/frozen projection, refusing any move that would overdraw. Idempotency
// keys make a replay a no-op.
export function createPgFinanceRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async getWallet(userId) {
      const result = await pool().query("select * from wallet_accounts where user_id = $1", [userId]);
      return normalizeWallet(result.rows[0]);
    },

    async findTransactionByIdempotencyKey(key) {
      if (!key) return null;
      const result = await pool().query("select * from ledger_transactions where idempotency_key = $1", [key]);
      return normalizeTransaction(result.rows[0]);
    },

    async listTransactions(userId, limit = 50) {
      // Transactions that touch either of the user's wallet accounts.
      const result = await pool().query(
        `select distinct t.* from ledger_transactions t
         join ledger_entries e on e.transaction_id = t.id
         where e.account = any($1)
         order by t.created_at desc
         limit $2`,
        [[`user:${userId}:available`, `user:${userId}:frozen`], limit]
      );
      return result.rows.map(normalizeTransaction);
    },

    // Recompute the wallet balance straight from the immutable ledger — the proof
    // that the projection is derivable and never drifts.
    async recomputeBalance(userId) {
      const sums = await pool().query(
        `select e.account,
                coalesce(sum(case when e.direction = 'credit' then e.amount_cny_minor else -e.amount_cny_minor end), 0) as net
         from ledger_entries e
         join ledger_transactions t on t.id = e.transaction_id
         where t.status = 'posted' and e.account = any($1)
         group by e.account`,
        [[`user:${userId}:available`, `user:${userId}:frozen`]]
      );
      let available = 0;
      let frozen = 0;
      for (const row of sums.rows) {
        if (row.account === `user:${userId}:available`) available = Number(row.net);
        if (row.account === `user:${userId}:frozen`) frozen = Number(row.net);
      }
      return { availableCnyMinor: available, frozenCnyMinor: frozen };
    },

    async postTransaction(input) {
      assertBalanced(input.entries);
      const client = await pool().connect();
      try {
        await client.query("begin");
        const result = await applyLedgerPost(client, input);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        if (error.code === "23505" && input.idempotencyKey) {
          const existing = await this.findTransactionByIdempotencyKey(input.idempotencyKey);
          if (existing) {
            return { transaction: existing, wallet: await this.getWallet(input.userId), replay: true };
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-05-03 exchange rates ----
    async setExchangeRate({ currency, cnyPerUnitMicro, adminUserId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const prev = (await client.query(
          "select coalesce(max(version), 0) as v from exchange_rates where currency = $1",
          [currency]
        )).rows[0];
        await client.query("update exchange_rates set active = false where currency = $1 and active", [currency]);
        const row = (await client.query(
          `insert into exchange_rates (currency, cny_per_unit_micro, version, active, created_by_admin_id)
           values ($1, $2, $3, true, $4) returning *`,
          [currency, cnyPerUnitMicro, Number(prev.v) + 1, adminUserId || null]
        )).rows[0];
        await client.query("commit");
        return normalizeRate(row);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async getActiveRate(currency) {
      if (currency === "CNY") return { currency: "CNY", cnyPerUnitMicro: 1000000, version: 0, active: true };
      const result = await pool().query("select * from exchange_rates where currency = $1 and active", [currency]);
      return normalizeRate(result.rows[0]);
    },

    async listRates(currency = null) {
      const result = await pool().query(
        `select * from exchange_rates where ($1::text is null or currency = $1) order by currency asc, version desc`,
        [currency]
      );
      return result.rows.map(normalizeRate);
    },

    // ---- V2-05-04 top-ups ----
    async createTopUp(input) {
      const result = await pool().query(
        `insert into top_ups
           (top_up_no, user_id, provider, channel, original_currency, original_amount_minor,
            fee_cny_minor, cny_credited_minor, rate_micro_snapshot, system_status, provider_txn_id, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created', $10, $11) returning *`,
        [
          input.topUpNo, input.userId, input.provider, input.channel || "", input.originalCurrency || "CNY",
          input.originalAmountMinor, input.feeCnyMinor || 0, input.cnyCreditedMinor, input.rateMicroSnapshot,
          input.providerTxnId || null, input.idempotencyKey || null
        ]
      );
      return normalizeTopUp(result.rows[0]);
    },

    async findTopUpById(id) {
      const result = await pool().query("select * from top_ups where id = $1", [id]);
      return normalizeTopUp(result.rows[0]);
    },

    async findTopUpByIdempotency(userId, key) {
      if (!key) return null;
      const result = await pool().query("select * from top_ups where user_id = $1 and idempotency_key = $2", [userId, key]);
      return normalizeTopUp(result.rows[0]);
    },

    async findTopUpByProviderTxn(provider, providerTxnId) {
      const result = await pool().query("select * from top_ups where provider = $1 and provider_txn_id = $2", [provider, providerTxnId]);
      return normalizeTopUp(result.rows[0]);
    },

    async listTopUps(userId, limit = 50) {
      const result = await pool().query("select * from top_ups where user_id = $1 order by created_at desc limit $2", [userId, limit]);
      return result.rows.map(normalizeTopUp);
    },

    async markTopUp(id, patch) {
      const result = await pool().query(
        `update top_ups set
           system_status = coalesce($2, system_status),
           channel_status = coalesce($3, channel_status),
           provider_txn_id = coalesce($4, provider_txn_id),
           verify_result = coalesce($5, verify_result)
         where id = $1 returning *`,
        [id, patch.systemStatus ?? null, patch.channelStatus ?? null, patch.providerTxnId ?? null, patch.verifyResult ?? null]
      );
      return normalizeTopUp(result.rows[0]);
    },

    // V2-05-07 — settle a top-up: credit the wallet AND mark succeeded in one
    // transaction. Idempotent: a top-up already succeeded returns as a replay and
    // never credits twice.
    async settleTopUp({ topUpId, channelStatus, verifyResult }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const top = (await client.query("select * from top_ups where id = $1 for update", [topUpId])).rows[0];
        if (!top) {
          await client.query("rollback");
          return { topUp: null };
        }
        if (top.system_status === "succeeded") {
          await client.query("commit");
          return { topUp: normalizeTopUp(top), replay: true };
        }
        const post = await applyLedgerPost(client, {
          userId: top.user_id,
          txNo: generateBusinessNumber("LTX"),
          type: "top_up",
          amountCnyMinor: Number(top.cny_credited_minor),
          businessType: "top_up",
          businessRef: top.id,
          idempotencyKey: `topup:${top.id}`,
          initiatorType: "user",
          initiatorId: top.user_id,
          entries: [
            { account: "external:provider", direction: "debit", amountMinor: Number(top.cny_credited_minor) },
            { account: `user:${top.user_id}:available`, direction: "credit", amountMinor: Number(top.cny_credited_minor) }
          ]
        });
        const updated = (await client.query(
          `update top_ups set system_status = 'succeeded', channel_status = coalesce($2, channel_status),
             verify_result = coalesce($3, verify_result), ledger_tx_id = $4 where id = $1 returning *`,
          [topUpId, channelStatus ?? null, verifyResult ?? null, post.transaction.id]
        )).rows[0];
        await client.query("commit");
        return { topUp: normalizeTopUp(updated), transaction: post.transaction, replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-05-13/14 withdrawals ----
    // Request: freeze available → frozen AND create the row in one transaction.
    async createWithdrawalWithFreeze({ withdrawalNo, userId, amountMinor, source, payeeRef }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const post = await applyLedgerPost(client, {
          userId, txNo: generateBusinessNumber("LTX"), type: "withdrawal_freeze",
          amountCnyMinor: amountMinor, businessType: "withdrawal", initiatorType: "user", initiatorId: userId,
          entries: [
            { account: `user:${userId}:available`, direction: "debit", amountMinor },
            { account: `user:${userId}:frozen`, direction: "credit", amountMinor }
          ]
        });
        const row = (await client.query(
          `insert into withdrawals (withdrawal_no, user_id, amount_cny_minor, source, payee_ref, status, freeze_tx_id)
           values ($1, $2, $3, $4, $5, 'pending_review', $6) returning *`,
          [withdrawalNo, userId, amountMinor, source || "original_route", payeeRef || "", post.transaction.id]
        )).rows[0];
        await client.query("commit");
        return { withdrawal: normalizeWithdrawal(row) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findWithdrawal(id) {
      const result = await pool().query("select * from withdrawals where id = $1", [id]);
      return normalizeWithdrawal(result.rows[0]);
    },

    async listWithdrawals(userId, limit = 50) {
      const result = await pool().query("select * from withdrawals where user_id = $1 order by created_at desc limit $2", [userId, limit]);
      return result.rows.map(normalizeWithdrawal);
    },

    async markWithdrawal(id, patch) {
      const result = await pool().query(
        `update withdrawals set status = coalesce($2, status), reviewer_admin_id = coalesce($3, reviewer_admin_id),
           reason = coalesce($4, reason), failure_reason = coalesce($5, failure_reason) where id = $1 returning *`,
        [id, patch.status ?? null, patch.reviewerAdminId ?? null, patch.reason ?? null, patch.failureReason ?? null]
      );
      return normalizeWithdrawal(result.rows[0]);
    },

    // Execute: processing → succeeded, settle frozen out. Idempotent (a succeeded
    // withdrawal is a replay — never a second refund).
    async executeWithdrawal({ withdrawalId, reviewerAdminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const w = (await client.query("select * from withdrawals where id = $1 for update", [withdrawalId])).rows[0];
        if (!w) { await client.query("rollback"); return { withdrawal: null }; }
        if (w.status === "succeeded") { await client.query("commit"); return { withdrawal: normalizeWithdrawal(w), replay: true }; }
        if (w.status !== "processing") {
          await client.query("rollback");
          const error = new Error("Withdrawal is not in processing."); error.code = "WITHDRAWAL_STATE"; throw error;
        }
        const amount = Number(w.amount_cny_minor);
        const post = await applyLedgerPost(client, {
          userId: w.user_id, txNo: generateBusinessNumber("LTX"), type: "withdrawal_settle",
          amountCnyMinor: amount, businessType: "withdrawal", businessRef: w.id,
          idempotencyKey: `withdraw-settle:${w.id}`, initiatorType: "admin", initiatorId: reviewerAdminId || null,
          entries: [
            { account: `user:${w.user_id}:frozen`, direction: "debit", amountMinor: amount },
            { account: "external:withdrawal", direction: "credit", amountMinor: amount }
          ]
        });
        const updated = (await client.query("update withdrawals set status = 'succeeded', settle_tx_id = $2 where id = $1 returning *", [withdrawalId, post.transaction.id])).rows[0];
        await client.query("commit");
        return { withdrawal: normalizeWithdrawal(updated), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // Reject/fail: unfreeze frozen → available and mark the terminal status.
    async unfreezeWithdrawal({ withdrawalId, newStatus, reviewerAdminId, reason }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const w = (await client.query("select * from withdrawals where id = $1 for update", [withdrawalId])).rows[0];
        if (!w) { await client.query("rollback"); return { withdrawal: null }; }
        if (!["pending_review", "processing"].includes(w.status)) {
          await client.query("rollback");
          const error = new Error("Withdrawal cannot be reversed from its current status."); error.code = "WITHDRAWAL_STATE"; throw error;
        }
        const amount = Number(w.amount_cny_minor);
        const post = await applyLedgerPost(client, {
          userId: w.user_id, txNo: generateBusinessNumber("LTX"), type: "withdrawal_unfreeze",
          amountCnyMinor: amount, businessType: "withdrawal", businessRef: w.id,
          idempotencyKey: `withdraw-unfreeze:${w.id}`, initiatorType: "admin", initiatorId: reviewerAdminId || null,
          entries: [
            { account: `user:${w.user_id}:frozen`, direction: "debit", amountMinor: amount },
            { account: `user:${w.user_id}:available`, direction: "credit", amountMinor: amount }
          ]
        });
        const updated = (await client.query(
          `update withdrawals set status = $2, unfreeze_tx_id = $3, reviewer_admin_id = coalesce($4, reviewer_admin_id),
             failure_reason = coalesce($5, failure_reason) where id = $1 returning *`,
          [withdrawalId, newStatus, post.transaction.id, reviewerAdminId || null, reason || null]
        )).rows[0];
        await client.query("commit");
        return { withdrawal: normalizeWithdrawal(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-05-15/16 adjustments ----
    async createAdjustment(input) {
      const result = await pool().query(
        `insert into adjustment_requests
           (adjustment_no, user_id, direction, amount_cny_minor, reason, evidence, business_ref, initiator_admin_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [input.adjustmentNo, input.userId, input.direction, input.amountMinor, input.reason,
         JSON.stringify(input.evidence || []), input.businessRef || "", input.initiatorAdminId || null]
      );
      return normalizeAdjustment(result.rows[0]);
    },

    async findAdjustment(id) {
      const result = await pool().query("select * from adjustment_requests where id = $1", [id]);
      return normalizeAdjustment(result.rows[0]);
    },

    async listAdjustments(limit = 50) {
      const result = await pool().query("select * from adjustment_requests order by created_at desc limit $1", [limit]);
      return result.rows.map(normalizeAdjustment);
    },

    async markAdjustment(id, patch) {
      const result = await pool().query(
        `update adjustment_requests set status = coalesce($2, status), approver_admin_id = coalesce($3, approver_admin_id),
           reauth_ref = coalesce($4, reauth_ref), failure_reason = coalesce($5, failure_reason) where id = $1 returning *`,
        [id, patch.status ?? null, patch.approverAdminId ?? null, patch.reauthRef ?? null, patch.failureReason ?? null]
      );
      return normalizeAdjustment(result.rows[0]);
    },

    async sumExecutedAdjustmentsToday(userId) {
      const result = await pool().query(
        `select coalesce(sum(amount_cny_minor), 0) as s from adjustment_requests
         where user_id = $1 and status = 'executed' and created_at >= date_trunc('day', now())`,
        [userId]
      );
      return Number(result.rows[0].s);
    },

    // Approve + execute in one transaction. Idempotent (executed → replay).
    // Insufficient funds on a debit lands on execution_failed (diagnosable),
    // never a silent drop.
    async executeAdjustment({ adjustmentId, approverAdminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const a = (await client.query("select * from adjustment_requests where id = $1 for update", [adjustmentId])).rows[0];
        if (!a) { await client.query("rollback"); return { adjustment: null }; }
        if (a.status === "executed") { await client.query("commit"); return { adjustment: normalizeAdjustment(a), replay: true }; }
        if (!["pending_review", "approved"].includes(a.status)) {
          await client.query("rollback");
          const error = new Error("Adjustment is not executable."); error.code = "ADJUSTMENT_STATE"; throw error;
        }
        const amount = Number(a.amount_cny_minor);
        const entries = a.direction === "credit"
          ? [{ account: "external:adjustment", direction: "debit", amountMinor: amount }, { account: `user:${a.user_id}:available`, direction: "credit", amountMinor: amount }]
          : [{ account: `user:${a.user_id}:available`, direction: "debit", amountMinor: amount }, { account: "external:adjustment", direction: "credit", amountMinor: amount }];
        let post;
        try {
          post = await applyLedgerPost(client, {
            userId: a.user_id, txNo: generateBusinessNumber("LTX"), type: `adjust_${a.direction}`,
            amountCnyMinor: amount, businessType: "adjustment", businessRef: a.id, idempotencyKey: `adjust:${a.id}`,
            initiatorType: "admin", initiatorId: a.initiator_admin_id, approverAdminId: approverAdminId || null, entries
          });
        } catch (err) {
          if (err.code === "WALLET_INSUFFICIENT") {
            await client.query("rollback");
            const failed = (await pool().query(
              "update adjustment_requests set status = 'execution_failed', approver_admin_id = $2, failure_reason = 'insufficient_balance' where id = $1 returning *",
              [adjustmentId, approverAdminId || null]
            )).rows[0];
            return { adjustment: normalizeAdjustment(failed), failed: true };
          }
          throw err;
        }
        const updated = (await client.query(
          "update adjustment_requests set status = 'executed', approver_admin_id = $2, execution_tx_id = $3 where id = $1 returning *",
          [adjustmentId, approverAdminId || null, post.transaction.id]
        )).rows[0];
        await client.query("commit");
        return { adjustment: normalizeAdjustment(updated), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // ---- V2-05-17 top-up exception workbench ----
    async listTopUpExceptions({ statuses = ["failed", "expired", "exception"], limit = 50, offset = 0 } = {}) {
      const result = await pool().query(
        "select * from top_ups where system_status = any($1) order by created_at desc limit $2 offset $3",
        [statuses, limit, offset]
      );
      return result.rows.map(normalizeTopUp);
    },

    // ---- V2-05-18 reconciliation ----
    async findReconciliationBatch(fileHash) {
      const result = await pool().query("select * from reconciliation_batches where file_hash = $1", [fileHash]);
      return normalizeBatch(result.rows[0]);
    },

    async createReconciliationBatch({ fileHash, provider, importedByAdminId, recordCount, diffs }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const batch = (await client.query(
          `insert into reconciliation_batches (file_hash, provider, record_count, diff_count, imported_by_admin_id)
           values ($1, $2, $3, $4, $5) returning *`,
          [fileHash, provider, recordCount, diffs.length, importedByAdminId || null]
        )).rows[0];
        for (const d of diffs) {
          await client.query(
            `insert into reconciliation_diffs
               (batch_id, provider_txn_id, diff_type, provider_amount_minor, local_amount_minor, provider_currency, cny_minor, usd_minor, detail)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [batch.id, d.providerTxnId, d.diffType, d.providerAmountMinor ?? null, d.localAmountMinor ?? null,
             d.providerCurrency || "CNY", d.cnyMinor ?? null, d.usdMinor ?? null, JSON.stringify(d.detail || {})]
          );
        }
        await client.query("commit");
        return normalizeBatch(batch);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listReconciliationDiffs(batchId) {
      const result = await pool().query("select * from reconciliation_diffs where batch_id = $1 order by created_at asc", [batchId]);
      return result.rows.map(normalizeDiff);
    }
  };
}

export function normalizeBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    fileHash: row.file_hash,
    provider: row.provider,
    recordCount: row.record_count,
    diffCount: row.diff_count,
    importedByAdminId: row.imported_by_admin_id,
    createdAt: row.created_at
  };
}

export function normalizeDiff(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    providerTxnId: row.provider_txn_id,
    diffType: row.diff_type,
    providerAmountMinor: row.provider_amount_minor === null ? null : Number(row.provider_amount_minor),
    localAmountMinor: row.local_amount_minor === null ? null : Number(row.local_amount_minor),
    providerCurrency: row.provider_currency,
    cnyMinor: row.cny_minor === null ? null : Number(row.cny_minor),
    usdMinor: row.usd_minor === null ? null : Number(row.usd_minor),
    detail: row.detail || {},
    createdAt: row.created_at
  };
}

export function normalizeAdjustment(row) {
  if (!row) return null;
  return {
    id: row.id,
    adjustmentNo: row.adjustment_no,
    userId: row.user_id,
    direction: row.direction,
    amountCnyMinor: Number(row.amount_cny_minor),
    reason: row.reason,
    evidence: row.evidence || [],
    businessRef: row.business_ref,
    status: row.status,
    initiatorAdminId: row.initiator_admin_id,
    approverAdminId: row.approver_admin_id,
    reauthRef: row.reauth_ref,
    executionTxId: row.execution_tx_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    withdrawalNo: row.withdrawal_no,
    userId: row.user_id,
    amountCnyMinor: Number(row.amount_cny_minor),
    source: row.source,
    payeeRef: row.payee_ref,
    status: row.status,
    freezeTxId: row.freeze_tx_id,
    settleTxId: row.settle_tx_id,
    unfreezeTxId: row.unfreeze_tx_id,
    reviewerAdminId: row.reviewer_admin_id,
    reason: row.reason,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Runs a balanced ledger post inside an already-open transaction `client`.
async function applyLedgerPost(client, input) {
  const { userId, entries } = input;
  assertBalanced(entries);

  if (input.idempotencyKey) {
    const existing = (await client.query("select * from ledger_transactions where idempotency_key = $1", [input.idempotencyKey])).rows[0];
    if (existing) {
      const wallet = (await client.query("select * from wallet_accounts where user_id = $1", [userId])).rows[0];
      return { transaction: normalizeTransaction(existing), wallet: normalizeWallet(wallet), replay: true };
    }
  }

  await client.query("insert into wallet_accounts (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
  const wallet = (await client.query("select * from wallet_accounts where user_id = $1 for update", [userId])).rows[0];

  const { availableDelta, frozenDelta } = walletDeltas(userId, entries);
  const newAvailable = Number(wallet.available_cny_minor) + availableDelta;
  const newFrozen = Number(wallet.frozen_cny_minor) + frozenDelta;
  if (newAvailable < 0 || newFrozen < 0) {
    const error = new Error("Insufficient wallet balance.");
    error.code = "WALLET_INSUFFICIENT";
    throw error;
  }

  const tx = (await client.query(
    `insert into ledger_transactions
       (tx_no, type, status, business_type, business_ref, idempotency_key, currency,
        amount_cny_minor, initiator_type, initiator_id, approver_admin_id, reverses_tx_id, posted_at)
     values ($1, $2, 'posted', $3, $4, $5, $6, $7, $8, $9, $10, $11, now()) returning *`,
    [
      input.txNo, input.type, input.businessType || "", input.businessRef || null,
      input.idempotencyKey || null, input.currency || "CNY", input.amountCnyMinor,
      input.initiatorType || "system", input.initiatorId || null, input.approverAdminId || null,
      input.reversesTxId || null
    ]
  )).rows[0];

  for (const entry of entries) {
    await client.query(
      "insert into ledger_entries (transaction_id, account, direction, amount_cny_minor) values ($1, $2, $3, $4)",
      [tx.id, entry.account, entry.direction, entry.amountMinor]
    );
  }

  const updatedWallet = (await client.query(
    "update wallet_accounts set available_cny_minor = $2, frozen_cny_minor = $3, version = version + 1 where user_id = $1 returning *",
    [userId, newAvailable, newFrozen]
  )).rows[0];

  return { transaction: normalizeTransaction(tx), wallet: normalizeWallet(updatedWallet), replay: false };
}

export function normalizeRate(row) {
  if (!row) return null;
  return {
    id: row.id,
    currency: row.currency,
    cnyPerUnitMicro: Number(row.cny_per_unit_micro),
    version: row.version,
    active: row.active,
    createdAt: row.created_at
  };
}

export function normalizeTopUp(row) {
  if (!row) return null;
  return {
    id: row.id,
    topUpNo: row.top_up_no,
    userId: row.user_id,
    provider: row.provider,
    channel: row.channel,
    originalCurrency: row.original_currency,
    originalAmountMinor: Number(row.original_amount_minor),
    feeCnyMinor: Number(row.fee_cny_minor),
    cnyCreditedMinor: Number(row.cny_credited_minor),
    rateMicroSnapshot: Number(row.rate_micro_snapshot),
    systemStatus: row.system_status,
    channelStatus: row.channel_status,
    providerTxnId: row.provider_txn_id,
    verifyResult: row.verify_result,
    riskTags: row.risk_tags || [],
    ledgerTxId: row.ledger_tx_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// A wallet account for `userId` gains on credits and loses on debits.
export function walletDeltas(userId, entries) {
  let availableDelta = 0;
  let frozenDelta = 0;
  const available = `user:${userId}:available`;
  const frozen = `user:${userId}:frozen`;
  for (const entry of entries) {
    const signed = entry.direction === "credit" ? entry.amountMinor : -entry.amountMinor;
    if (entry.account === available) availableDelta += signed;
    if (entry.account === frozen) frozenDelta += signed;
  }
  return { availableDelta, frozenDelta };
}

export function assertBalanced(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error("A ledger transaction needs at least two entries.");
  }
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    if (!Number.isInteger(entry.amountMinor) || entry.amountMinor <= 0) {
      throw new Error("Ledger entry amount must be a positive integer.");
    }
    if (entry.direction === "debit") debit += entry.amountMinor;
    else if (entry.direction === "credit") credit += entry.amountMinor;
    else throw new Error("Ledger entry direction must be debit or credit.");
  }
  if (debit !== credit) {
    throw new Error(`Unbalanced ledger transaction: debit ${debit} != credit ${credit}.`);
  }
}

export function normalizeWallet(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    availableCnyMinor: Number(row.available_cny_minor),
    frozenCnyMinor: Number(row.frozen_cny_minor),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    txNo: row.tx_no,
    type: row.type,
    status: row.status,
    businessType: row.business_type,
    businessRef: row.business_ref,
    idempotencyKey: row.idempotency_key,
    currency: row.currency,
    amountCnyMinor: Number(row.amount_cny_minor),
    initiatorType: row.initiator_type,
    initiatorId: row.initiator_id,
    approverAdminId: row.approver_admin_id,
    reversesTxId: row.reverses_tx_id,
    createdAt: row.created_at,
    postedAt: row.posted_at
  };
}
