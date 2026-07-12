-- V2-05-01/02 CNY wallet + double-entry ledger. Replaces the flat single-balance
-- `wallets` model (V2-00-10 audit: wallet = REPLACE). The balance fields on
-- wallet_accounts are a PROJECTION of the ledger, not an independent source of
-- truth: every transaction's entries sum to zero (debits == credits) and are
-- immutable, so a balance can always be recomputed from the ledger.

create table if not exists wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  available_cny_minor bigint not null default 0 check (available_cny_minor >= 0),
  frozen_cny_minor bigint not null default 0 check (frozen_cny_minor >= 0),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wallet_accounts_user_unique on wallet_accounts (user_id);

drop trigger if exists wallet_accounts_set_updated_at on wallet_accounts;
create trigger wallet_accounts_set_updated_at
before update on wallet_accounts
for each row execute function set_updated_at();

-- A posted ledger transaction is immutable; a pending one may only advance to
-- posted or failed. Reversals are NEW opposite transactions that reference the
-- original (reverses_tx_id) — the original row is never rewritten.
create or replace function ledger_reject_posted_update() returns trigger as $$
begin
  if OLD.status = 'posted' then
    raise exception 'Posted ledger transaction is immutable (%).', OLD.tx_no
      using errcode = 'restrict_violation';
  end if;
  return NEW;
end;
$$ language plpgsql;

create table if not exists ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  tx_no text not null unique,
  type text not null,
  status text not null default 'posted' check (status in ('pending', 'posted', 'failed')),
  business_type text not null default '',
  business_ref uuid,
  idempotency_key text,
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  amount_cny_minor bigint not null check (amount_cny_minor >= 0),
  initiator_type text not null default 'system' check (initiator_type in ('user', 'admin', 'system')),
  initiator_id uuid,
  approver_admin_id uuid,
  reverses_tx_id uuid references ledger_transactions (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create unique index if not exists ledger_transactions_idem
  on ledger_transactions (idempotency_key) where idempotency_key is not null;
create index if not exists ledger_transactions_business_idx
  on ledger_transactions (business_type, business_ref);
create index if not exists ledger_transactions_type_idx
  on ledger_transactions (type, created_at desc);

drop trigger if exists ledger_transactions_immutable on ledger_transactions;
create trigger ledger_transactions_immutable
before update on ledger_transactions
for each row execute function ledger_reject_posted_update();

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references ledger_transactions (id) on delete cascade,
  account text not null,
  direction text not null check (direction in ('debit', 'credit')),
  amount_cny_minor bigint not null check (amount_cny_minor > 0),
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_tx_idx on ledger_entries (transaction_id);
create index if not exists ledger_entries_account_idx on ledger_entries (account);

drop trigger if exists ledger_entries_immutable on ledger_entries;
create trigger ledger_entries_immutable
before update on ledger_entries
for each row execute function catalog_reject_update();
