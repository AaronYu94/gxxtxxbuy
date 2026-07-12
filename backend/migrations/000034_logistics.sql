-- V2-07-01/02/03 carriers, shipping routes, and versioned route prices.
-- A price change creates a NEW active version; historical parcels keep the exact
-- version they were billed on, so editing prices never rewrites past shipments.
-- All money is integer CNY minor units.

create table if not exists carriers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipping_routes (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers (id) on delete cascade,
  code text not null unique,
  name text not null default '',
  country text not null default '',
  -- Restriction categories this route ACCEPTS (normal/battery/liquid/…).
  restriction_types jsonb not null default '["normal"]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_routes_carrier_idx on shipping_routes (carrier_id);
create index if not exists shipping_routes_country_idx on shipping_routes (country, enabled);

create table if not exists route_price_versions (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references shipping_routes (id) on delete cascade,
  version integer not null default 1,
  first_weight_grams integer not null check (first_weight_grams > 0),
  first_price_minor bigint not null check (first_price_minor >= 0),
  continued_step_grams integer not null default 500 check (continued_step_grams > 0),
  continued_price_minor bigint not null default 0 check (continued_price_minor >= 0),
  volumetric_divisor integer not null default 6000 check (volumetric_divisor > 0),
  rounding_grams integer not null default 1 check (rounding_grams > 0),
  fuel_surcharge_bps integer not null default 0 check (fuel_surcharge_bps >= 0),
  remote_surcharge_minor bigint not null default 0 check (remote_surcharge_minor >= 0),
  operation_fee_minor bigint not null default 0 check (operation_fee_minor >= 0),
  insurance_bps integer not null default 0 check (insurance_bps >= 0),
  eta_days integer not null default 0 check (eta_days >= 0),
  max_weight_grams integer check (max_weight_grams is null or max_weight_grams > 0),
  active boolean not null default true,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Only one active price version per route.
create unique index if not exists route_price_versions_active_unique
  on route_price_versions (route_id) where active;
create index if not exists route_price_versions_route_idx on route_price_versions (route_id, version desc);

drop trigger if exists carriers_set_updated_at on carriers;
create trigger carriers_set_updated_at before update on carriers for each row execute function set_updated_at();
drop trigger if exists shipping_routes_set_updated_at on shipping_routes;
create trigger shipping_routes_set_updated_at before update on shipping_routes for each row execute function set_updated_at();
