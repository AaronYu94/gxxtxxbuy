-- V2-06-11 official warehousing. Completing QC (four photos + measurement + no
-- open exception) creates the inventory unit and stamps the official inbound
-- time, which is also the 5-day return-window start. The inbound time is set
-- once and never overwritten; completing again is idempotent.

create table if not exists inventory_units (
  id uuid primary key default gen_random_uuid(),
  stock_no text not null unique,
  item_order_id uuid not null references item_orders (id) on delete cascade,
  qc_task_id uuid references qc_tasks (id) on delete set null,
  user_id uuid not null references users (id) on delete cascade,
  status text not null default 'in_stock' check (status in (
    'in_stock', 'reserved', 'picking', 'packing', 'return_reserved', 'returning',
    'destroy_pending', 'outbound', 'returned', 'destroyed', 'exception'
  )),
  -- Set once at QC completion; the 5-day return window starts here.
  official_inbound_at timestamptz not null,
  return_deadline_at timestamptz not null,
  location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One inventory unit per item order.
create unique index if not exists inventory_units_item_unique on inventory_units (item_order_id);
create index if not exists inventory_units_user_idx on inventory_units (user_id, created_at desc);
create index if not exists inventory_units_status_idx on inventory_units (status, official_inbound_at);

drop trigger if exists inventory_units_set_updated_at on inventory_units;
create trigger inventory_units_set_updated_at
before update on inventory_units
for each row execute function set_updated_at();
