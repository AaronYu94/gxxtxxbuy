-- V2-06-16/17/18 storage rules, reminders, and destruction.
--
-- Free storage is 90 days from the official inbound time; up to two paid
-- one-month extensions (10 CNY each) push the deadline to at most 150 days.
-- Destruction is only eligible at 150 days and is irreversible. Reminders at
-- 15/7/3/0 days are sent at most once each (unique per milestone).

alter table inventory_units add column if not exists paid_extension_months integer not null default 0
  check (paid_extension_months >= 0 and paid_extension_months <= 2);

create table if not exists storage_extensions (
  id uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references inventory_units (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  months integer not null check (months > 0),
  amount_cny_minor bigint not null check (amount_cny_minor > 0),
  ledger_tx_id uuid references ledger_transactions (id),
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists storage_extensions_idem_unique
  on storage_extensions (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists storage_extensions_unit_idx on storage_extensions (inventory_unit_id, created_at desc);

create table if not exists storage_reminders (
  id uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references inventory_units (id) on delete cascade,
  milestone integer not null check (milestone in (15, 7, 3, 0)),
  created_at timestamptz not null default now()
);

-- One reminder per milestone per unit (a repeated cron never double-notifies).
create unique index if not exists storage_reminders_unique
  on storage_reminders (inventory_unit_id, milestone);

create table if not exists destroy_records (
  id uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references inventory_units (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  photo_keys jsonb not null default '[]'::jsonb,
  executed_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists destroy_records_unit_unique on destroy_records (inventory_unit_id);
