-- V2-09-08/09/10 — account risk events, finance-initiated lock requests, and the
-- super-admin approval + status-history trail.
--
-- Locking sets users.status to risk_locked/banned; the auth layer already rejects
-- any authenticated request from a non-'normal' account, so a lock automatically
-- forbids ordering, top-ups, parcel submission, withdrawals, and profile edits.
-- Risk events are idempotent per external id; sensitive evidence is referenced,
-- not inlined. Auto-rules are opt-in (default OFF).

create table if not exists account_risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  type text not null check (type in ('login', 'payment', 'address', 'chargeback', 'withdrawal', 'other')),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  -- Non-sensitive descriptor; raw evidence lives behind evidence_ref (a storage key
  -- in the isolated evidence domain), never in this row.
  detail jsonb not null default '{}'::jsonb,
  evidence_ref text not null default '',
  auto_rule text not null default '',
  external_id text not null,
  created_at timestamptz not null default now()
);

-- Idempotency: a replayed external event is a no-op.
create unique index if not exists account_risk_events_external_unique on account_risk_events (external_id);
create index if not exists account_risk_events_user_idx on account_risk_events (user_id, created_at desc);

create table if not exists account_lock_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  target_status text not null check (target_status in ('risk_locked', 'banned')),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  initiated_by_admin_id uuid references admin_users (id) on delete set null,
  approver_admin_id uuid references admin_users (id) on delete set null,
  decision_reason text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active (pending) lock request per user (no duplicate submissions).
create unique index if not exists account_lock_requests_active_unique
  on account_lock_requests (user_id) where status = 'pending_review';
create index if not exists account_lock_requests_status_idx on account_lock_requests (status, created_at desc);

drop trigger if exists account_lock_requests_set_updated_at on account_lock_requests;
create trigger account_lock_requests_set_updated_at
before update on account_lock_requests
for each row execute function set_updated_at();

create table if not exists account_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  from_status text not null default '',
  to_status text not null,
  action text not null,
  actor_type text not null default 'admin',
  actor_admin_id uuid references admin_users (id) on delete set null,
  reason text not null default '',
  lock_request_id uuid references account_lock_requests (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_status_history_user_idx on account_status_history (user_id, created_at asc);
