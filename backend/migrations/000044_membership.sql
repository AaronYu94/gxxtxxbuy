-- V2-09-05/06 — membership tier config (versioned) + growth-value ledger.
--
-- The whole tier ladder is one versioned config document (thresholds, freight
-- discount, benefits). Publishing a new version deactivates the previous active
-- one; old versions stay for historical explanation. Only the active version
-- drives live calculations, and editing never rewrites past results.
--
-- Growth value accrues ONLY from international shipping the user actually paid
-- (V2-07-16); refunds claw it back. Each accrual carries an idempotency key so a
-- replayed payment/refund event never double-counts.

create table if not exists membership_config_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  tiers jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists membership_config_version_unique on membership_config_versions (version);
create unique index if not exists membership_config_active_unique on membership_config_versions (active) where active;

create table if not exists membership_growth_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  delta_growth_minor bigint not null,
  source text not null check (source in ('shipping_paid', 'refund_clawback', 'adjustment')),
  business_type text not null default '',
  business_ref text not null default '',
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

-- The idempotency guard: a replayed payment/refund event is a no-op.
create unique index if not exists membership_growth_idem_unique on membership_growth_ledger (idempotency_key);
create index if not exists membership_growth_user_idx on membership_growth_ledger (user_id, created_at desc);
