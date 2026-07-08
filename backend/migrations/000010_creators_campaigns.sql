create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users (id) on delete set null,
  code text not null unique,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(code) between 2 and 80)
);

create index if not exists creators_status_idx on creators (status);

drop trigger if exists creators_set_updated_at on creators;
create trigger creators_set_updated_at
before update on creators
for each row
execute function set_updated_at();

create table if not exists creator_campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators (id) on delete cascade,
  code text not null unique,
  name text not null default '',
  landing_url text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(code) between 2 and 80)
);

create index if not exists creator_campaigns_creator_idx on creator_campaigns (creator_id, status);

drop trigger if exists creator_campaigns_set_updated_at on creator_campaigns;
create trigger creator_campaigns_set_updated_at
before update on creator_campaigns
for each row
execute function set_updated_at();

create table if not exists creator_attributions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators (id) on delete cascade,
  campaign_id uuid references creator_campaigns (id) on delete set null,
  session_id text not null default '',
  user_id uuid references users (id) on delete set null,
  purchase_order_id uuid references purchase_orders (id) on delete set null,
  touch_type text not null default 'visit' check (touch_type in ('visit', 'signup', 'order')),
  created_at timestamptz not null default now()
);

-- One idempotent touch per (creator, campaign, session, touch_type). A blank session
-- still allows one row per touch_type so unauthenticated visits are never lost.
create unique index if not exists creator_attributions_unique_touch_idx
on creator_attributions (creator_id, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), session_id, touch_type);

create index if not exists creator_attributions_creator_idx on creator_attributions (creator_id, touch_type, created_at desc);
create index if not exists creator_attributions_user_idx on creator_attributions (user_id) where user_id is not null;
