-- V2-09-11 — address blacklist (address fingerprints only; no IP blacklist).
--
-- A blacklist entry carries the strict fingerprint (unique) and the fuzzy key.
-- Matching a candidate address on either an exact fingerprint or a shared fuzzy
-- key routes it to MANUAL REVIEW; a match never automatically bans an account.

create table if not exists address_blacklist (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  fuzzy_key text not null default '',
  country_code text not null default '',
  reason text not null default '',
  added_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists address_blacklist_fuzzy_idx on address_blacklist (fuzzy_key);

create table if not exists address_review_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  candidate jsonb not null default '{}'::jsonb,
  match_kind text not null check (match_kind in ('exact', 'fuzzy')),
  blacklist_id uuid references address_blacklist (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'cleared', 'confirmed')),
  created_at timestamptz not null default now()
);

create index if not exists address_review_flags_status_idx on address_review_flags (status, created_at desc);
