create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'admin')),
  user_id uuid references users (id) on delete cascade,
  admin_user_id uuid references admin_users (id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint sessions_actor_owner_check check (
    (actor_type = 'user' and user_id is not null and admin_user_id is null)
    or
    (actor_type = 'admin' and user_id is null and admin_user_id is not null)
  )
);

create index if not exists sessions_actor_user_idx on sessions (actor_type, user_id);
create index if not exists sessions_actor_admin_idx on sessions (actor_type, admin_user_id);
create index if not exists sessions_expires_at_idx on sessions (expires_at);
create index if not exists sessions_refresh_expires_at_idx on sessions (refresh_expires_at);

drop trigger if exists sessions_set_updated_at on sessions;
create trigger sessions_set_updated_at
before update on sessions
for each row
execute function set_updated_at();
