-- V2-03 link parsing and immutable product snapshots.
-- catalog_parse_jobs is mutable (status machine); catalog_snapshots and
-- catalog_price_calculations are immutable historical records — updates are
-- rejected at the database layer (V2-03-11). A forced correction must create a
-- new snapshot, never overwrite an existing one.

-- Shared guard used by every immutable catalog table.
create or replace function catalog_reject_update() returns trigger as $$
begin
  raise exception 'Catalog row is immutable and cannot be updated (table %). Create a new record instead.', tg_table_name
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

create table if not exists catalog_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  parse_job_id uuid,
  saved_link_id uuid references saved_links (id) on delete set null,
  platform text not null,
  source_url text not null,
  shop text not null default '',
  title text not null,
  main_image text not null default '',
  images jsonb not null default '[]'::jsonb,
  price_cents bigint not null check (price_cents > 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  -- NULL = domestic shipping unknown. It must never be silently read as 0.
  domestic_shipping_cents bigint check (domestic_shipping_cents is null or domestic_shipping_cents >= 0),
  spec text not null default '',
  sizes jsonb not null default '[]'::jsonb,
  colors jsonb not null default '[]'::jsonb,
  skus jsonb not null default '[]'::jsonb,
  price_tiers jsonb not null default '[]'::jsonb,
  min_order_quantity integer check (min_order_quantity is null or min_order_quantity > 0),
  -- 'scraped' fields come from a provider; 'manual' fields were entered by the
  -- user. The two are never merged into an indistinguishable blob (V2-03-08).
  source text not null check (source in ('scraped', 'manual')),
  source_captured_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists catalog_snapshots_user_idx
  on catalog_snapshots (user_id, created_at desc);
create index if not exists catalog_snapshots_parse_job_idx
  on catalog_snapshots (parse_job_id);

drop trigger if exists catalog_snapshots_immutable on catalog_snapshots;
create trigger catalog_snapshots_immutable
before update on catalog_snapshots
for each row execute function catalog_reject_update();

create table if not exists catalog_parse_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  saved_link_id uuid references saved_links (id) on delete set null,
  -- Idempotency key: same user + same canonical link → same job. A duplicate
  -- submit returns the existing job instead of creating a second one.
  request_key text not null,
  platform text not null,
  url text not null,
  ref jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'retrying', 'snapshotted', 'manual', 'dead_letter')),
  attempt integer not null default 0 check (attempt >= 0),
  reason text not null default '',
  snapshot_id uuid references catalog_snapshots (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_parse_jobs_request_unique
  on catalog_parse_jobs (user_id, request_key);
create index if not exists catalog_parse_jobs_status_idx
  on catalog_parse_jobs (status, updated_at desc);

drop trigger if exists catalog_parse_jobs_set_updated_at on catalog_parse_jobs;
create trigger catalog_parse_jobs_set_updated_at
before update on catalog_parse_jobs
for each row execute function set_updated_at();

create table if not exists catalog_price_calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  snapshot_id uuid not null references catalog_snapshots (id) on delete cascade,
  spec text not null default '',
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  items_cents bigint not null check (items_cents > 0),
  domestic_shipping_cents bigint check (domestic_shipping_cents is null or domestic_shipping_cents >= 0),
  total_cents bigint check (total_cents is null or total_cents > 0),
  complete boolean not null,
  reason text not null default '',
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create index if not exists catalog_price_calculations_snapshot_idx
  on catalog_price_calculations (snapshot_id, created_at desc);

drop trigger if exists catalog_price_calculations_immutable on catalog_price_calculations;
create trigger catalog_price_calculations_immutable
before update on catalog_price_calculations
for each row execute function catalog_reject_update();
