-- V2-06-12/13/14/15 warehouse locations, double-scan assignment/movement, and
-- shipping restrictions. A location code is unique; a location with inventory
-- cannot be deleted and cannot be disabled while occupied. Location is only
-- changed by a two-scan action (item code + location code), never a plain form
-- edit, and every move is recorded with its reason and origin.

create table if not exists warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  area text not null default '',
  shelf text not null default '',
  level text not null default '',
  position text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists warehouse_locations_set_updated_at on warehouse_locations;
create trigger warehouse_locations_set_updated_at
before update on warehouse_locations
for each row execute function set_updated_at();

-- Location reference from inventory + shipping-restriction snapshot (route filter).
alter table inventory_units add column if not exists shipping_restrictions jsonb not null default '[]'::jsonb;

create table if not exists location_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references inventory_units (id) on delete cascade,
  from_location_id uuid references warehouse_locations (id) on delete set null,
  to_location_id uuid references warehouse_locations (id) on delete set null,
  reason text not null default '',
  moved_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists location_movements_unit_idx on location_movements (inventory_unit_id, created_at asc);

create table if not exists shipping_restriction_changes (
  id uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references inventory_units (id) on delete cascade,
  restrictions jsonb not null default '[]'::jsonb,
  changed_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shipping_restriction_changes_unit_idx on shipping_restriction_changes (inventory_unit_id, created_at desc);
