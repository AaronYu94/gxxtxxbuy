create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  actor_user_id uuid references users (id) on delete set null,
  actor_admin_user_id uuid references admin_users (id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz not null default now(),
  constraint audit_logs_actor_check check (
    (actor_type = 'user' and actor_user_id is not null and actor_admin_user_id is null)
    or
    (actor_type = 'admin' and actor_user_id is null and actor_admin_user_id is not null)
    or
    (actor_type = 'system' and actor_user_id is null and actor_admin_user_id is null)
  )
);

create index if not exists audit_logs_actor_idx
on audit_logs (actor_type, actor_user_id, actor_admin_user_id, created_at desc);

create index if not exists audit_logs_resource_idx
on audit_logs (resource_type, resource_id, created_at desc);

create index if not exists audit_logs_action_idx
on audit_logs (action, created_at desc);
