-- V2-08-08/09 — return verification/packing inspection + ship-back-to-merchant.
--
-- Inspection compares the returned item against the QC record (quantity/spec),
-- with private photos and a measurement, before packing. The ship-back record
-- snapshots the merchant address (never overwritten) and carries a de-duplicated
-- carrier tracking number plus an event log for rejection / logistics exceptions.

create table if not exists after_sales_return_inspections (
  id uuid primary key default gen_random_uuid(),
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  quantity_matched boolean not null default true,
  spec_matched boolean not null default true,
  photo_keys jsonb not null default '[]'::jsonb,
  weight_grams integer check (weight_grams is null or weight_grams > 0),
  length_mm integer check (length_mm is null or length_mm > 0),
  width_mm integer check (width_mm is null or width_mm > 0),
  height_mm integer check (height_mm is null or height_mm > 0),
  note text not null default '',
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists after_sales_return_inspections_unique on after_sales_return_inspections (after_sales_id);

create table if not exists after_sales_shipments (
  id uuid primary key default gen_random_uuid(),
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  carrier text not null default '',
  tracking_no text not null default '',
  -- Merchant return address snapshot, frozen at ship time (never overwritten).
  merchant_address_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'shipped' check (status in ('shipped', 'delivered', 'rejected', 'exception')),
  events jsonb not null default '[]'::jsonb,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists after_sales_shipments_order_unique on after_sales_shipments (after_sales_id);
-- Tracking numbers are de-duplicated across return shipments.
create unique index if not exists after_sales_shipments_tracking_unique
  on after_sales_shipments (tracking_no) where tracking_no <> '';

drop trigger if exists after_sales_shipments_set_updated_at on after_sales_shipments;
create trigger after_sales_shipments_set_updated_at
before update on after_sales_shipments
for each row execute function set_updated_at();
