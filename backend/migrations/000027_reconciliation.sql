-- V2-05-18 channel reconciliation. Importing a provider settlement file is
-- idempotent by file hash. Differences (missing locally, amount mismatch, status
-- mismatch) are RECORDED for a human to resolve — they NEVER auto-adjust the
-- ledger (manual credits must go through the adjustment maker-checker). Original
-- currency plus CNY and USD are preserved on each diff.

create table if not exists reconciliation_batches (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null unique,
  provider text not null,
  record_count integer not null default 0,
  diff_count integer not null default 0,
  imported_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists reconciliation_diffs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references reconciliation_batches (id) on delete cascade,
  provider_txn_id text not null,
  diff_type text not null check (diff_type in ('missing_local', 'amount_mismatch', 'status_mismatch')),
  provider_amount_minor bigint,
  local_amount_minor bigint,
  provider_currency text not null default 'CNY',
  cny_minor bigint,
  usd_minor bigint,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reconciliation_diffs_batch_idx on reconciliation_diffs (batch_id);
