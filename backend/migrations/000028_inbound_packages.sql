-- V2-06-01/02/03 domestic inbound packages. A warehouse operator scans a
-- courier number on arrival; it matches an item sub-order's registered domestic
-- tracking number (from V2-04-14) and binds the package to exactly one user and
-- one order. No match → an 'unclaimed' record that a human links later with
-- permission + evidence + audit (never guessing the user). A duplicate scan
-- returns the existing record with the first scanner + time, never a second row.

create table if not exists inbound_packages (
  id uuid primary key default gen_random_uuid(),
  domestic_tracking_no text not null,
  carrier text not null default '',
  -- Bound on match / manual link. One package → one order → one user.
  item_order_id uuid references item_orders (id) on delete set null,
  user_id uuid references users (id) on delete set null,
  status text not null default 'unclaimed'
    check (status in ('unclaimed', 'matched', 'measured')),
  first_scanned_by_admin_id uuid references admin_users (id) on delete set null,
  first_scanned_at timestamptz not null default now(),
  -- V2-06-04 measurement.
  weight_grams integer check (weight_grams is null or weight_grams > 0),
  length_mm integer check (length_mm is null or length_mm > 0),
  width_mm integer check (width_mm is null or width_mm > 0),
  height_mm integer check (height_mm is null or height_mm > 0),
  photo_keys jsonb not null default '[]'::jsonb,
  measured_at timestamptz,
  measurement_version integer not null default 0,
  -- Manual-link provenance (V2-06-03).
  linked_by_admin_id uuid references admin_users (id) on delete set null,
  link_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One package per courier number (a re-scan finds this row instead of adding one).
create unique index if not exists inbound_packages_tracking_unique
  on inbound_packages (domestic_tracking_no);
-- One package per item order.
create unique index if not exists inbound_packages_item_unique
  on inbound_packages (item_order_id) where item_order_id is not null;
create index if not exists inbound_packages_status_idx on inbound_packages (status, created_at desc);
create index if not exists inbound_packages_user_idx on inbound_packages (user_id, created_at desc);

drop trigger if exists inbound_packages_set_updated_at on inbound_packages;
create trigger inbound_packages_set_updated_at
before update on inbound_packages
for each row execute function set_updated_at();
