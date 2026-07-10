-- V2 user account preferences, versioned addresses, and asynchronous anonymization.

alter table users
  add column if not exists phone_verified_at timestamptz,
  add column if not exists version integer not null default 1,
  add column if not exists deletion_requested_at timestamptz;
alter table users add constraint users_version_positive_check check (version > 0);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  recipient_name text not null,
  phone text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region text not null default '',
  city text not null,
  postal_code text not null,
  line1 text not null,
  line2 text not null default '',
  is_default boolean not null default false,
  normalized_hash text not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists addresses_one_default_per_user_unique
  on addresses (user_id) where is_default = true and deleted_at is null;
create index if not exists addresses_user_active_idx
  on addresses (user_id, updated_at desc) where deleted_at is null;
create index if not exists addresses_normalized_hash_idx
  on addresses (normalized_hash);

drop trigger if exists addresses_set_updated_at on addresses;
create trigger addresses_set_updated_at
before update on addresses
for each row execute function set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parcels_address_id_fkey'
  ) then
    alter table parcels
      add constraint parcels_address_id_fkey
      foreign key (address_id) references addresses (id) on delete set null not valid;
  end if;
end;
$$;

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'cancelled', 'blocked')),
  blockers jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_one_open_per_user_unique
  on account_deletion_requests (user_id)
  where status in ('pending', 'processing');
create index if not exists account_deletion_pending_idx
  on account_deletion_requests (status, requested_at) where status = 'pending';

drop trigger if exists account_deletion_requests_set_updated_at on account_deletion_requests;
create trigger account_deletion_requests_set_updated_at
before update on account_deletion_requests
for each row execute function set_updated_at();
