-- V2-11-04/05 — 5-tier promotion levels (versioned config) + effective-amount
-- ledger.
--
-- The tier ladder (thresholds + commission rate) is one versioned config document;
-- publishing a new version deactivates the old, and a rate change never rewrites a
-- commission that was already generated (commissions snapshot their own rate). The
-- effective-amount ledger accumulates a promoter's qualifying invitee spend (the
-- FROZEN commission base only); each entry is idempotent per business event, and a
-- refund claws it back traceably.

create table if not exists referral_tier_config_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  tiers jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists referral_tier_config_version_unique on referral_tier_config_versions (version);
create unique index if not exists referral_tier_config_active_unique on referral_tier_config_versions (active) where active;

create table if not exists referral_effective_ledger (
  id uuid primary key default gen_random_uuid(),
  promoter_user_id uuid not null references users (id) on delete cascade,
  delta_minor bigint not null,
  source text not null check (source in ('signed_parcel', 'refund_clawback', 'adjustment')),
  business_ref text not null default '',
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists referral_effective_idem_unique on referral_effective_ledger (idempotency_key);
create index if not exists referral_effective_promoter_idx on referral_effective_ledger (promoter_user_id, created_at desc);
