-- V2-10-18 — unified notification dispatch log + dead-letter.
--
-- Every notifiable business event dispatches through here with an idempotency key
-- (event_key), so a replayed event never double-notifies. Failed dispatches are
-- retried; exhausted retries land in the dead-letter table for alerting. User
-- preferences gate marketing notifications but never transactional ones.

create table if not exists notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  type text not null,
  user_id uuid references users (id) on delete set null,
  channel text not null default 'email',
  category text not null default 'transactional' check (category in ('transactional', 'marketing')),
  status text not null default 'sent' check (status in ('sent', 'suppressed', 'failed', 'dead')),
  attempts integer not null default 1 check (attempts >= 0),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency: one dispatch per business event.
create unique index if not exists notification_dispatches_event_unique on notification_dispatches (event_key);
create index if not exists notification_dispatches_user_idx on notification_dispatches (user_id, created_at desc);

drop trigger if exists notification_dispatches_set_updated_at on notification_dispatches;
create trigger notification_dispatches_set_updated_at
before update on notification_dispatches
for each row execute function set_updated_at();
