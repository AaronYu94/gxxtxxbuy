-- V2-11-01/02/03 — invitation relationships + referral codes.
--
-- Each user has one unpredictable referral code (repeated generation returns the
-- same one). A user binds to AT MOST ONE inviter, permanently; self-invites and
-- cycles are rejected. A binding is created at signup (an invalid code never blocks
-- registration — it is recorded with a reason instead).

create table if not exists referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists referral_codes_user_unique on referral_codes (user_id);

create table if not exists referral_bindings (
  id uuid primary key default gen_random_uuid(),
  invitee_user_id uuid not null references users (id) on delete cascade,
  inviter_user_id uuid not null references users (id) on delete cascade,
  code text not null default '',
  source text not null default 'signup',
  created_at timestamptz not null default now(),
  check (invitee_user_id <> inviter_user_id)
);

-- One inviter per invitee (permanent binding).
create unique index if not exists referral_bindings_invitee_unique on referral_bindings (invitee_user_id);
create index if not exists referral_bindings_inviter_idx on referral_bindings (inviter_user_id);

-- Attempts that did not bind (invalid code, self-invite, cycle) are recorded for
-- attribution auditing without blocking registration.
create table if not exists referral_binding_attempts (
  id uuid primary key default gen_random_uuid(),
  invitee_user_id uuid references users (id) on delete set null,
  code text not null default '',
  reason text not null,
  created_at timestamptz not null default now()
);
