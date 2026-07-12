-- V2-11-10/11/12 — commission withdrawals, freeze/disqualify, refund clawback.
--
-- A withdrawal (min 2000 CNY) freezes the amount, is reviewed, then paid out;
-- failure unfreezes and a duplicate payment is guarded. Bank-card details are NOT
-- stored here — only an opaque bank_account_ref (into the isolated Restricted
-- security domain) plus a last-4 for display. Freeze/disqualify require a reason +
-- evidence and never delete history. A refund clawback reverses at most the
-- original commission, once, and may drive the available balance negative
-- (traceably) when the commission was already settled.

create table if not exists commission_withdrawals (
  id uuid primary key default gen_random_uuid(),
  wd_no text not null unique,
  promoter_user_id uuid not null references users (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  bank_account_ref text not null default '',
  bank_last4 text not null default '',
  status text not null default 'pending_review' check (status in ('pending_review', 'processing', 'succeeded', 'rejected', 'failed')),
  freeze_tx_id uuid references commission_transactions (id),
  settle_tx_id uuid references commission_transactions (id),
  unfreeze_tx_id uuid references commission_transactions (id),
  reviewer_admin_id uuid references admin_users (id) on delete set null,
  decision_reason text not null default '',
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commission_withdrawals_status_idx on commission_withdrawals (status, created_at desc);
create index if not exists commission_withdrawals_promoter_idx on commission_withdrawals (promoter_user_id, created_at desc);

drop trigger if exists commission_withdrawals_set_updated_at on commission_withdrawals;
create trigger commission_withdrawals_set_updated_at
before update on commission_withdrawals
for each row execute function set_updated_at();

create table if not exists commission_qualifications (
  promoter_user_id uuid primary key references users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'frozen', 'disqualified')),
  reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists commission_disciplinary_records (
  id uuid primary key default gen_random_uuid(),
  promoter_user_id uuid not null references users (id) on delete cascade,
  action text not null check (action in ('freeze', 'unfreeze', 'disqualify')),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  actor_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);
