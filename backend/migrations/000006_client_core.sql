create table if not exists saved_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  url text not null check (char_length(url) <= 2048),
  url_hash text not null,
  domain text not null default '',
  platform text not null check (platform in ('Taobao', '1688', 'Weidian', 'Yupoo', 'Other')),
  status text not null default 'needs_details' check (status in ('saved', 'needs_details', 'parsing', 'parsed', 'failed', 'added_to_haul')),
  title text not null default '',
  spec text not null default '',
  price_cents integer check (price_cents is null or price_cents > 0),
  currency text not null default 'USD',
  quantity integer not null default 1 check (quantity > 0),
  note text not null default '',
  parse_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url_hash)
);

create index if not exists saved_links_user_status_idx on saved_links (user_id, status, created_at desc);
create index if not exists saved_links_platform_idx on saved_links (platform);

drop trigger if exists saved_links_set_updated_at on saved_links;
create trigger saved_links_set_updated_at
before update on saved_links
for each row
execute function set_updated_at();

create table if not exists haul_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  saved_link_id uuid not null references saved_links (id) on delete restrict,
  title text not null,
  spec text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'USD',
  quantity integer not null check (quantity > 0),
  note text not null default '',
  source_platform text not null default 'Other',
  source_domain text not null default '',
  status text not null default 'waiting_purchase' check (status in ('waiting_purchase', 'purchasing', 'seller_shipped', 'arrived', 'qc_ready', 'approved', 'ready_to_ship', 'parcel_submitted', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, saved_link_id)
);

create index if not exists haul_items_user_status_idx on haul_items (user_id, status, created_at desc);

drop trigger if exists haul_items_set_updated_at on haul_items;
create trigger haul_items_set_updated_at
before update on haul_items
for each row
execute function set_updated_at();

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  haul_item_id uuid not null references haul_items (id) on delete restrict,
  status text not null default 'submitted' check (status in ('submitted', 'purchasing', 'seller_shipped', 'arrived', 'qc_ready', 'cancelled', 'exception')),
  exception text not null default '',
  external_order_no text not null default '',
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, haul_item_id)
);

create index if not exists purchase_orders_user_status_idx on purchase_orders (user_id, status, created_at desc);

drop trigger if exists purchase_orders_set_updated_at on purchase_orders;
create trigger purchase_orders_set_updated_at
before update on purchase_orders
for each row
execute function set_updated_at();

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references purchase_orders (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by_type text not null check (changed_by_type in ('user', 'admin', 'system')),
  changed_by_user_id uuid references users (id) on delete set null,
  changed_by_admin_user_id uuid references admin_users (id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx on order_status_history (order_id, created_at desc);
create index if not exists order_status_history_user_idx on order_status_history (user_id, created_at desc);

create table if not exists policy_pages (
  id uuid primary key default gen_random_uuid(),
  policy_type text not null unique,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists policy_pages_status_idx on policy_pages (status, policy_type);

drop trigger if exists policy_pages_set_updated_at on policy_pages;
create trigger policy_pages_set_updated_at
before update on policy_pages
for each row
execute function set_updated_at();

insert into policy_pages (policy_type, title, body, status, published_at)
values
  ('fees', 'Fees', 'Item price, domestic shipping, service fee, estimated shipping, and final shipping must stay visible.', 'published', now()),
  ('qc', 'QC', 'QC photos help users review visible details before shipping. They are not an authenticity guarantee.', 'published', now()),
  ('storage', 'Storage', 'Items get 90 days of free warehouse storage after arrival before long-term storage rules apply.', 'published', now()),
  ('shipping', 'Shipping', 'Estimated shipping can change after final packing, chargeable weight, and carrier confirmation.', 'published', now()),
  ('refunds', 'Refunds', 'Refund availability depends on order status, seller handling, and which services have already been performed.', 'published', now()),
  ('privacy', 'Privacy', 'Users can only access their own orders, QC, parcels, wallet, and saved links.', 'published', now())
on conflict (policy_type) do nothing;
