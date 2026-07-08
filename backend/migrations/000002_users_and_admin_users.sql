create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  display_name text not null default '',
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists users_email_normalized_active_unique
on users (email_normalized)
where deleted_at is null;

create index if not exists users_status_idx on users (status);

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row
execute function set_updated_at();

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  display_name text not null default '',
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists admin_users_email_normalized_active_unique
on admin_users (email_normalized)
where deleted_at is null;

create index if not exists admin_users_status_idx on admin_users (status);

drop trigger if exists admin_users_set_updated_at on admin_users;
create trigger admin_users_set_updated_at
before update on admin_users
for each row
execute function set_updated_at();
