-- V2-05-03 currency + exchange-rate versioning, and V2-05-04 top-up orders.
--
-- exchange_rates is versioned: setting a new rate for a currency inserts a new
-- active row and deactivates the prior one, so an edit only affects NEW
-- conversions while history is preserved. Each conversion snapshots the exact
-- rate onto the consuming record (e.g. top_ups), never a live lookup.
--
-- top_ups keep the SYSTEM status separate from the raw CHANNEL status, enforce a
-- 10 CNY minimum, and make the provider transaction id unique so a duplicate or
-- out-of-order webhook can only settle once.

create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- CNY minor units per 1 whole unit of `currency` (e.g. USD→CNY ≈ 720000 = 7.2).
  cny_per_unit_micro bigint not null check (cny_per_unit_micro > 0),
  version integer not null default 1,
  active boolean not null default true,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Only one active rate per currency.
create unique index if not exists exchange_rates_active_unique
  on exchange_rates (currency) where active;
create index if not exists exchange_rates_currency_idx
  on exchange_rates (currency, created_at desc);

create table if not exists top_ups (
  id uuid primary key default gen_random_uuid(),
  top_up_no text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  channel text not null default '',
  original_currency text not null default 'CNY' check (original_currency ~ '^[A-Z]{3}$'),
  original_amount_minor bigint not null check (original_amount_minor > 0),
  fee_cny_minor bigint not null default 0 check (fee_cny_minor >= 0),
  -- CNY that will be credited on success. >= 1000 (10 CNY minimum).
  cny_credited_minor bigint not null check (cny_credited_minor >= 1000),
  rate_micro_snapshot bigint not null check (rate_micro_snapshot > 0),
  -- System lifecycle (V2-00-06 充值单) vs. the raw provider/channel status string.
  system_status text not null default 'created'
    check (system_status in ('created', 'pending_provider', 'succeeded', 'failed', 'expired', 'exception')),
  channel_status text not null default '',
  provider_txn_id text,
  verify_result text not null default '',
  risk_tags jsonb not null default '[]'::jsonb,
  ledger_tx_id uuid references ledger_transactions (id),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists top_ups_provider_txn_unique
  on top_ups (provider, provider_txn_id) where provider_txn_id is not null;
create unique index if not exists top_ups_idem_unique
  on top_ups (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists top_ups_user_idx on top_ups (user_id, created_at desc);
create index if not exists top_ups_status_idx on top_ups (system_status, created_at desc);

drop trigger if exists top_ups_set_updated_at on top_ups;
create trigger top_ups_set_updated_at
before update on top_ups
for each row execute function set_updated_at();
