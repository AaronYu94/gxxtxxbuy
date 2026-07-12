-- V2-09-04 — user tags and groups.
--
-- Tags are manual or auto (rule-derived). Groups are static (explicit membership)
-- or dynamic (a versioned rule that is materialized by an idempotent recompute).
-- Rules are versioned: editing a rule bumps rule_version and a recompute records
-- the version it materialized. Group membership never carries sensitive fields;
-- the read layer returns masked identifiers only.

create table if not exists user_tags (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  kind text not null default 'manual' check (kind in ('manual', 'auto')),
  color text not null default '',
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists user_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  tag_id uuid not null references user_tags (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  assigned_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists user_tag_assignments_unique on user_tag_assignments (user_id, tag_id);
create index if not exists user_tag_assignments_tag_idx on user_tag_assignments (tag_id);

create table if not exists user_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  kind text not null check (kind in ('static', 'dynamic')),
  rule jsonb not null default '{}'::jsonb,
  rule_version integer not null default 1 check (rule_version > 0),
  enabled boolean not null default true,
  last_recomputed_at timestamptz,
  last_recomputed_version integer,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_groups_set_updated_at on user_groups;
create trigger user_groups_set_updated_at
before update on user_groups
for each row execute function set_updated_at();

create table if not exists user_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references user_groups (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  source text not null default 'static' check (source in ('static', 'dynamic')),
  created_at timestamptz not null default now()
);

create unique index if not exists user_group_members_unique on user_group_members (group_id, user_id);
create index if not exists user_group_members_user_idx on user_group_members (user_id);
