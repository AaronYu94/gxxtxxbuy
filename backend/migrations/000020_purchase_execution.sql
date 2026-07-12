-- V2-04-08 claim + V2-04-09 confirm-purchase.
--
-- A buyer claims an agent_ordering item (only one wins under concurrency) which
-- moves it to purchasing and records claimed_by. Confirming the purchase records
-- the real platform/account/order-no/quantity/cost with private voucher keys and
-- moves the item to seller_dispatch_pending. The confirmation is immutable and
-- unique per item (a purchase is confirmed once).

alter table item_orders add column if not exists claimed_by_admin_id uuid references admin_users (id) on delete set null;
alter table item_orders add column if not exists claimed_at timestamptz;

create index if not exists item_orders_claimed_idx on item_orders (claimed_by_admin_id);

create table if not exists purchase_confirmations (
  id uuid primary key default gen_random_uuid(),
  item_order_id uuid not null references item_orders (id) on delete cascade,
  buyer_admin_id uuid references admin_users (id) on delete set null,
  actual_platform text not null,
  actual_account text not null default '',
  actual_order_no text not null,
  spec text not null default '',
  quantity integer not null check (quantity > 0),
  cost_cents bigint not null check (cost_cents > 0),
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  -- Private storage object keys for purchase vouchers/screenshots — never public.
  voucher_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- One confirmation per item order (a purchase is confirmed exactly once).
create unique index if not exists purchase_confirmations_item_unique
  on purchase_confirmations (item_order_id);

drop trigger if exists purchase_confirmations_immutable on purchase_confirmations;
create trigger purchase_confirmations_immutable
before update on purchase_confirmations
for each row execute function catalog_reject_update();
