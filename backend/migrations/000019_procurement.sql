-- V2-04-04 procurement platform accounts + V2-04-05 item assignment columns.
--
-- purchase_accounts holds the shop accounts a buyer uses on each platform. It
-- stores only a non-secret reference/handle and an owner + enabled flag — never
-- credentials (those are secrets and must never live in the DB). Rows are
-- versioned (optimistic concurrency) and every change is audited in the service.

create table if not exists purchase_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  label text not null,
  account_ref text not null default '',
  role text not null default 'default' check (role in ('default', 'backup')),
  owner_admin_id uuid references admin_users (id) on delete set null,
  enabled boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_accounts_platform_idx
  on purchase_accounts (platform, role, enabled);

drop trigger if exists purchase_accounts_set_updated_at on purchase_accounts;
create trigger purchase_accounts_set_updated_at
before update on purchase_accounts
for each row execute function set_updated_at();

-- Assignment columns on item_orders (V2-04-05). platform is denormalized from
-- the snapshot so the purchase queue can filter/assign by platform without a join.
alter table item_orders add column if not exists platform text not null default '';
alter table item_orders add column if not exists purchase_account_id uuid references purchase_accounts (id) on delete set null;
alter table item_orders add column if not exists assigned_at timestamptz;

update item_orders io set platform = s.platform
  from catalog_snapshots s
  where io.snapshot_id = s.id and io.platform = '';

create index if not exists item_orders_platform_idx on item_orders (platform, fulfillment_status);
create index if not exists item_orders_account_idx on item_orders (purchase_account_id);
