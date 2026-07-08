create table if not exists risk_cases (
  id uuid primary key default gen_random_uuid(),
  risk_type text not null check (char_length(risk_type) between 2 and 60),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  subject_user_id uuid references users (id) on delete set null,
  subject_ref text not null default '',
  reason text not null default '',
  owner_admin_user_id uuid references admin_users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'coupon_abuse', 'order_exception')),
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists risk_cases_status_idx on risk_cases (status, created_at desc);
create index if not exists risk_cases_subject_idx on risk_cases (subject_user_id) where subject_user_id is not null;
-- Only one active auto-generated case per (subject_ref, risk_type, source) so the
-- coupon-abuse job can re-run without piling up duplicate open cases.
create unique index if not exists risk_cases_active_auto_idx
on risk_cases (source, risk_type, subject_ref)
where status in ('open', 'investigating') and source <> 'manual';

drop trigger if exists risk_cases_set_updated_at on risk_cases;
create trigger risk_cases_set_updated_at
before update on risk_cases
for each row
execute function set_updated_at();
