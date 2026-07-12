-- V2-05-15/16 manual ledger adjustments (maker-checker). Finance initiates a
-- credit/debit request with a reason + evidence; a super-admin (never the same
-- person) approves, which executes exactly one balanced ledger transaction. A
-- failed execution keeps a diagnosable status rather than silently retrying.

create table if not exists adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  adjustment_no text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  amount_cny_minor bigint not null check (amount_cny_minor > 0),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  business_ref text not null default '',
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'executed', 'rejected', 'execution_failed')),
  initiator_admin_id uuid references admin_users (id) on delete set null,
  approver_admin_id uuid references admin_users (id) on delete set null,
  reauth_ref text not null default '',
  execution_tx_id uuid references ledger_transactions (id),
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists adjustment_requests_user_idx on adjustment_requests (user_id, created_at desc);
create index if not exists adjustment_requests_status_idx on adjustment_requests (status, created_at desc);

drop trigger if exists adjustment_requests_set_updated_at on adjustment_requests;
create trigger adjustment_requests_set_updated_at
before update on adjustment_requests
for each row execute function set_updated_at();
