-- V2-07-04/05/06/07 — consolidation parcels, stock reservation, address snapshot,
-- and the value-added-service catalog.
--
-- A consolidation parcel bundles warehoused inventory units for one international
-- shipment. Creating a draft snapshots the delivery address (later address edits
-- never mutate an in-flight parcel) and RESERVES each unit: an inventory unit may
-- be in at most one non-terminal parcel at a time (the partial unique index below
-- is the load-bearing guard against double-reservation). The frozen international
-- parcel state machine (V2-00-06) governs `status`.

-- V2-07-07 — value-added service catalog (super-admin configured, price-versioned
-- by simple edit; a parcel snapshots the price it was quoted).
create table if not exists value_added_services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  description text not null default '',
  price_cny_minor bigint not null default 0 check (price_cny_minor >= 0),
  requires_photo boolean not null default false,
  enabled boolean not null default true,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists value_added_services_set_updated_at on value_added_services;
create trigger value_added_services_set_updated_at
before update on value_added_services
for each row execute function set_updated_at();

create table if not exists consolidation_parcels (
  id uuid primary key default gen_random_uuid(),
  parcel_no text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  address_id uuid references addresses (id) on delete set null,
  -- V2-07-06 delivery address snapshot, frozen at draft time.
  recipient_snapshot jsonb not null default '{}'::jsonb,
  destination_country text not null default '',
  route_id uuid references shipping_routes (id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft', 'packing_fee_due', 'warehouse_acceptance_pending', 'picking', 'packing',
    'shipping_fee_due', 'outbound_pending', 'outbound', 'in_transit', 'delivered',
    'completed', 'cancelled', 'exception'
  )),
  packing_fee_bill_id uuid,
  shipping_fee_bill_id uuid,
  declared_weight_grams integer check (declared_weight_grams is null or declared_weight_grams > 0),
  final_weight_grams integer check (final_weight_grams is null or final_weight_grams > 0),
  chargeable_weight_grams integer check (chargeable_weight_grams is null or chargeable_weight_grams > 0),
  dimensions jsonb not null default '{}'::jsonb,
  tracking_no text not null default '',
  outbound_batch_id uuid,
  version integer not null default 1 check (version > 0),
  packing_started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consolidation_parcels_user_idx on consolidation_parcels (user_id, created_at desc);
create index if not exists consolidation_parcels_status_idx on consolidation_parcels (status);

drop trigger if exists consolidation_parcels_set_updated_at on consolidation_parcels;
create trigger consolidation_parcels_set_updated_at
before update on consolidation_parcels
for each row execute function set_updated_at();

-- V2-07-05 — reservation lines. A unit dropped from a parcel (pre-packing cancel)
-- gets released_at stamped; the partial unique index only counts live rows, so the
-- unit can then be reserved into another parcel.
create table if not exists consolidation_parcel_items (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  inventory_unit_id uuid not null references inventory_units (id) on delete restrict,
  item_order_id uuid not null references item_orders (id) on delete restrict,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

-- The occupancy guard: one live reservation per inventory unit, globally.
create unique index if not exists consolidation_parcel_items_unit_live_unique
  on consolidation_parcel_items (inventory_unit_id) where released_at is null;
create index if not exists consolidation_parcel_items_parcel_idx on consolidation_parcel_items (parcel_id);

-- V2-07-07 — value-added services attached to a parcel, with the price snapshotted
-- at attach time and an execution status filled in during packing (V2-07-14).
create table if not exists parcel_value_added_services (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  value_added_service_id uuid not null references value_added_services (id) on delete restrict,
  code text not null,
  name text not null default '',
  price_cny_minor bigint not null check (price_cny_minor >= 0),
  requires_photo boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  photo_keys jsonb not null default '[]'::jsonb,
  executed_by_admin_id uuid references admin_users (id) on delete set null,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists parcel_vas_parcel_idx on parcel_value_added_services (parcel_id);
create unique index if not exists parcel_vas_unique on parcel_value_added_services (parcel_id, value_added_service_id);
