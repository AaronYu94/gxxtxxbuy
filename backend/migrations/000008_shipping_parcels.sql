create table if not exists shipping_lines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  destination_country text not null,
  service_level text not null default 'standard',
  status text not null default 'active' check (status in ('active', 'disabled')),
  currency text not null default 'USD',
  billing_rules jsonb not null default '{}'::jsonb,
  restriction_rules jsonb not null default '{}'::jsonb,
  delivery_min_days integer check (delivery_min_days is null or delivery_min_days > 0),
  delivery_max_days integer check (delivery_max_days is null or delivery_max_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delivery_max_days is null or delivery_min_days is null or delivery_max_days >= delivery_min_days)
);

create index if not exists shipping_lines_country_status_idx
on shipping_lines (destination_country, status, service_level);

drop trigger if exists shipping_lines_set_updated_at on shipping_lines;
create trigger shipping_lines_set_updated_at
before update on shipping_lines
for each row
execute function set_updated_at();

create table if not exists parcels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  address_id uuid,
  shipping_line_id uuid references shipping_lines (id) on delete restrict,
  quote_id uuid,
  status text not null default 'draft' check (status in (
    'draft',
    'shipping_due',
    'payment_pending',
    'paid',
    'processing',
    'dispatched',
    'in_transit',
    'delivered',
    'cancelled'
  )),
  destination_country text not null default '',
  recipient_name text not null default '',
  address jsonb not null default '{}'::jsonb,
  chargeable_weight_grams integer check (chargeable_weight_grams is null or chargeable_weight_grams > 0),
  final_fee_cents integer check (final_fee_cents is null or final_fee_cents >= 0),
  currency text not null default 'USD',
  tracking_number text not null default '',
  submitted_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parcels_user_status_idx on parcels (user_id, status, created_at desc);
create index if not exists parcels_shipping_line_idx on parcels (shipping_line_id);

drop trigger if exists parcels_set_updated_at on parcels;
create trigger parcels_set_updated_at
before update on parcels
for each row
execute function set_updated_at();

create table if not exists parcel_items (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references parcels (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  warehouse_item_id uuid not null references warehouse_items (id) on delete restrict,
  haul_item_id uuid not null references haul_items (id) on delete restrict,
  weight_grams integer not null check (weight_grams > 0),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (parcel_id, warehouse_item_id)
);

create unique index if not exists parcel_items_one_active_idx
on parcel_items (warehouse_item_id)
where status = 'active';

create index if not exists parcel_items_user_idx on parcel_items (user_id, status, created_at desc);

create table if not exists shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  parcel_id uuid references parcels (id) on delete cascade,
  shipping_line_id uuid not null references shipping_lines (id) on delete restrict,
  destination_country text not null,
  status text not null default 'quoted' check (status in ('quoted', 'used', 'expired')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  actual_weight_grams integer not null check (actual_weight_grams > 0),
  volumetric_weight_grams integer not null check (volumetric_weight_grams >= 0),
  chargeable_weight_grams integer not null check (chargeable_weight_grams > 0),
  line_snapshot jsonb not null default '{}'::jsonb,
  item_snapshot jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists shipping_quotes_user_status_idx on shipping_quotes (user_id, status, expires_at desc);
create index if not exists shipping_quotes_parcel_idx on shipping_quotes (parcel_id);

create table if not exists shipping_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  parcel_id uuid not null references parcels (id) on delete restrict,
  idempotency_key text not null,
  payment_intent_id text not null unique,
  provider text not null default 'mock',
  status text not null default 'requires_payment' check (status in (
    'requires_payment',
    'processing',
    'succeeded',
    'failed',
    'cancelled'
  )),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists shipping_payments_user_status_idx on shipping_payments (user_id, status, created_at desc);
create index if not exists shipping_payments_parcel_idx on shipping_payments (parcel_id);

drop trigger if exists shipping_payments_set_updated_at on shipping_payments;
create trigger shipping_payments_set_updated_at
before update on shipping_payments
for each row
execute function set_updated_at();

create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  payment_intent_id text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references parcels (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  status text not null,
  location text not null default '',
  message text not null default '',
  occurred_at timestamptz not null default now(),
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tracking_events_parcel_idx on tracking_events (parcel_id, occurred_at asc);
create index if not exists tracking_events_user_idx on tracking_events (user_id, occurred_at desc);
