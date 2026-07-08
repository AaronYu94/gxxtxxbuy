create table if not exists country_shipping_rules (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  version integer not null default 1 check (version >= 1),
  title text not null default '',
  summary text not null default '',
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  expires_at timestamptz,
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country, version)
);

create index if not exists country_shipping_rules_country_idx on country_shipping_rules (country, status, version desc);

drop trigger if exists country_shipping_rules_set_updated_at on country_shipping_rules;
create trigger country_shipping_rules_set_updated_at
before update on country_shipping_rules
for each row
execute function set_updated_at();
