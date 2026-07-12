// V2-12-04 — post-restore integrity verification. After a PITR restore, the money
// ledgers must still balance and the double-entry invariant must hold. Run this
// against the recovered database; a passing result is part of the restore drill.
//
// `query(sql, params)` is a thin async DB accessor (e.g. pool.query).
export async function verifyLedgerIntegrity(query) {
  const checks = [];

  // 1. The commission ledger nets to zero across all accounts.
  const com = await query("select coalesce(sum(case when direction='credit' then amount_minor else -amount_minor end),0)::bigint s from commission_entries");
  const comSum = Number(com.rows[0].s);
  checks.push({ name: "commission_ledger_balanced", ok: comSum === 0, value: comSum });

  // 2. Every commission transaction is internally balanced (debits === credits).
  const comTx = await query(
    `select count(*)::int c from (
       select transaction_id, sum(case when direction='credit' then amount_minor else -amount_minor end) net
       from commission_entries group by transaction_id having sum(case when direction='credit' then amount_minor else -amount_minor end) <> 0
     ) unbalanced`
  );
  checks.push({ name: "commission_transactions_balanced", ok: comTx.rows[0].c === 0, value: comTx.rows[0].c });

  // 3. The finance wallet ledger transactions are each balanced.
  const finTx = await query(
    `select count(*)::int c from (
       select transaction_id, sum(case when direction='credit' then amount_cny_minor else -amount_cny_minor end) net
       from ledger_entries group by transaction_id having sum(case when direction='credit' then amount_cny_minor else -amount_cny_minor end) <> 0
     ) unbalanced`
  );
  checks.push({ name: "finance_transactions_balanced", ok: finTx.rows[0].c === 0, value: finTx.rows[0].c });

  // 4. Membership/referral effective ledgers are append-only signed sums (no NaN).
  const eff = await query("select count(*)::int c from referral_effective_ledger where delta_minor is null");
  checks.push({ name: "referral_effective_wellformed", ok: eff.rows[0].c === 0, value: eff.rows[0].c });

  return { ok: checks.every((c) => c.ok), checks };
}
