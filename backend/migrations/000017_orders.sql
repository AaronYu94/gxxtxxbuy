-- V2-04 母子订单与采购. V2-00-10 audit marks 母子订单 as REPLACE via an
-- expand-and-contract migration: the flat legacy purchase_orders table stays in
-- place for domains still referencing it (warehouse, creators), while the V2
-- two-level order model is added here as new tables.
--
-- order_parents (GO-PO): one submission + payment summary. It deliberately has
-- NO unified fulfillment status (V2-04-01) — every item sub-order fulfills on its
-- own. item_orders (GO-ITEM): one purchased specification, fulfilled
-- independently against an immutable catalog snapshot (V2-03-07). Fulfillment and
-- exception are two separate status fields (V2-00-06) so a price change or
-- stockout never overwrites the real fulfillment position.

create table if not exists order_parents (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  -- Idempotency: one client submission key maps to at most one parent order.
  submit_key text not null,
  item_count integer not null check (item_count > 0),
  -- Payment aggregation only. Sum of item payable totals captured at submit time.
  items_total_cents bigint not null check (items_total_cents >= 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  -- Payment lifecycle summary — NOT a fulfillment status.
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists order_parents_submit_unique
  on order_parents (user_id, submit_key);
create index if not exists order_parents_user_idx
  on order_parents (user_id, created_at desc);
-- Exact uppercase business-number search (V2-00-05).
create unique index if not exists order_parents_no_upper_idx
  on order_parents (upper(order_no));

drop trigger if exists order_parents_set_updated_at on order_parents;
create trigger order_parents_set_updated_at
before update on order_parents
for each row execute function set_updated_at();

create table if not exists item_orders (
  id uuid primary key default gen_random_uuid(),
  item_no text not null unique,
  parent_order_id uuid not null references order_parents (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  -- The purchased product is pinned to an immutable snapshot; restrict delete so
  -- the historical purchase basis can never vanish.
  snapshot_id uuid not null references catalog_snapshots (id) on delete restrict,
  -- Purchase intent captured at submit time (integer minor units throughout).
  spec text not null default '',
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  items_cents bigint not null check (items_cents > 0),
  -- Only purchasable items become orders, so domestic shipping is always known
  -- here — never a silent zero.
  domestic_shipping_cents bigint not null check (domestic_shipping_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  -- Dual status machine (V2-00-06): fulfillment position and exception overlay
  -- are tracked separately.
  fulfillment_status text not null default 'pending_payment' check (fulfillment_status in (
    'pending_payment', 'agent_ordering', 'purchasing', 'seller_dispatch_pending',
    'seller_dispatched', 'arrived', 'qc_in_progress', 'warehoused',
    'parcel_reserved', 'return_in_progress', 'destroy_pending', 'outbound',
    'completed', 'cancelled', 'refunded', 'destroyed'
  )),
  exception_status text not null default 'none' check (exception_status in (
    'none', 'price_change_pending', 'availability_pending',
    'customer_material_pending', 'refund_pending', 'manual_review', 'resolved'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_orders_parent_idx
  on item_orders (parent_order_id);
create index if not exists item_orders_user_idx
  on item_orders (user_id, created_at desc);
create index if not exists item_orders_fulfillment_idx
  on item_orders (fulfillment_status, updated_at desc);
create unique index if not exists item_orders_no_upper_idx
  on item_orders (upper(item_no));

drop trigger if exists item_orders_set_updated_at on item_orders;
create trigger item_orders_set_updated_at
before update on item_orders
for each row execute function set_updated_at();
