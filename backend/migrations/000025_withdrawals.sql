-- V2-05-13/14 ordinary wallet withdrawals. A request freezes the amount
-- immediately (available → frozen) and can only refund by the original route
-- (source is fixed at request time; the payee cannot be switched). Review moves
-- it to processing or rejects it (unfreeze); execution settles the frozen amount
-- out (original-route refund) or fails (unfreeze). Every state change references
-- the exact ledger transaction that moved money.

create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_no text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  amount_cny_minor bigint not null check (amount_cny_minor > 0),
  -- Only original-route refunds are allowed; the payee reference is captured once.
  source text not null default 'original_route',
  payee_ref text not null default '',
  status text not null default 'pending_review'
    check (status in ('pending_review', 'processing', 'succeeded', 'rejected', 'failed')),
  freeze_tx_id uuid references ledger_transactions (id),
  settle_tx_id uuid references ledger_transactions (id),
  unfreeze_tx_id uuid references ledger_transactions (id),
  reviewer_admin_id uuid references admin_users (id) on delete set null,
  reason text not null default '',
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawals_user_idx on withdrawals (user_id, created_at desc);
create index if not exists withdrawals_status_idx on withdrawals (status, created_at desc);

drop trigger if exists withdrawals_set_updated_at on withdrawals;
create trigger withdrawals_set_updated_at
before update on withdrawals
for each row execute function set_updated_at();
