create table if not exists warehouse_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders (id) on delete restrict,
  haul_item_id uuid not null references haul_items (id) on delete restrict,
  status text not null default 'received' check (status in ('received', 'qc_pending', 'qc_ready', 'extra_photo_requested', 'approved', 'ready_to_ship')),
  storage_location text not null default '',
  weight_grams integer check (weight_grams is null or weight_grams > 0),
  free_storage_days integer not null default 90 check (free_storage_days > 0),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id),
  unique (haul_item_id)
);

create index if not exists warehouse_items_user_status_idx on warehouse_items (user_id, status, received_at desc);
create index if not exists warehouse_items_received_at_idx on warehouse_items (received_at);

drop trigger if exists warehouse_items_set_updated_at on warehouse_items;
create trigger warehouse_items_set_updated_at
before update on warehouse_items
for each row
execute function set_updated_at();

create table if not exists qc_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  warehouse_item_id uuid not null references warehouse_items (id) on delete cascade,
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sort_order integer not null check (sort_order between 1 and 5),
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (warehouse_item_id, sort_order)
);

create index if not exists qc_photos_user_item_idx on qc_photos (user_id, warehouse_item_id, status);
create index if not exists qc_photos_storage_key_idx on qc_photos (storage_key);

create table if not exists extra_photo_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  warehouse_item_id uuid not null references warehouse_items (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create unique index if not exists extra_photo_requests_one_open_idx
on extra_photo_requests (warehouse_item_id)
where status = 'open';

create index if not exists extra_photo_requests_user_status_idx
on extra_photo_requests (user_id, status, created_at desc);
