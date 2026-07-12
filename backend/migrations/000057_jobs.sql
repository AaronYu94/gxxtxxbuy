-- V2-12-02 — queue job idempotency + dead-letter governance.
--
-- processed_jobs records a job's idempotency key once it has succeeded, so a
-- redelivered message is a no-op. dead_letter_jobs holds jobs that exhausted their
-- retries, for alerting + a permissioned, audited replay.

create table if not exists processed_jobs (
  idempotency_key text primary key,
  job_type text not null default '',
  processed_at timestamptz not null default now()
);

create table if not exists dead_letter_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  idempotency_key text not null,
  envelope jsonb not null,
  error text not null default '',
  attempts integer not null default 0,
  status text not null default 'dead' check (status in ('dead', 'replayed', 'discarded')),
  replayed_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dead_letter_jobs_status_idx on dead_letter_jobs (status, created_at desc);

drop trigger if exists dead_letter_jobs_set_updated_at on dead_letter_jobs;
create trigger dead_letter_jobs_set_updated_at
before update on dead_letter_jobs
for each row execute function set_updated_at();
