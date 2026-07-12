-- V2-11-06/07 — separate commission wallet (double-entry) + signed-parcel
-- commission generation.
--
-- The commission wallet is ISOLATED from the normal wallet: its own transactions +
-- entries tables, its own account namespace (commission:{user}:pending|available|
-- frozen|settled and commission:platform:pool). Entries balance (debits = credits)
-- and are immutable once posted, so a balance is always recomputable from the
-- ledger. A commission is generated only when a parcel is SIGNED, deduplicated by
-- the signed event, with the rate + base snapshotted onto the transaction.

create table if not exists commission_transactions (
  id uuid primary key default gen_random_uuid(),
  com_no text not null unique,
  promoter_user_id uuid not null references users (id) on delete cascade,
  invitee_user_id uuid references users (id) on delete set null,
  business_type text not null,
  business_ref text not null default '',
  idempotency_key text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  base_minor bigint not null default 0,
  commission_bps integer not null default 0,
  tier_level integer not null default 0,
  status text not null default 'posted' check (status in ('posted', 'reversed_by_reference')),
  created_at timestamptz not null default now()
);

create unique index if not exists commission_transactions_idem_unique on commission_transactions (idempotency_key);
create index if not exists commission_transactions_promoter_idx on commission_transactions (promoter_user_id, created_at desc);

create table if not exists commission_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references commission_transactions (id) on delete cascade,
  account text not null,
  direction text not null check (direction in ('debit', 'credit')),
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now()
);

create index if not exists commission_entries_tx_idx on commission_entries (transaction_id);
create index if not exists commission_entries_account_idx on commission_entries (account);

-- Posted commission transactions + entries are immutable (reversal is a new,
-- reference-linked transaction, never an in-place edit) — raises SQLSTATE 23001.
create or replace function commission_reject_mutation() returns trigger as $$
begin
  raise exception 'commission ledger rows are immutable once posted' using errcode = '23001';
end;
$$ language plpgsql;

drop trigger if exists commission_entries_no_update on commission_entries;
create trigger commission_entries_no_update
before update on commission_entries
for each row execute function commission_reject_mutation();
