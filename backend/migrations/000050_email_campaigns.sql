-- V2-10-08/09/10 — promotional email campaigns, batched sending, delivery stats.
--
-- The audience is snapshotted (frozen) when the campaign is scheduled, so later
-- audience changes never affect an in-flight send. Recipients are chunked into
-- batches; pausing only affects batches not yet sent. Sending is idempotent per
-- recipient and per batch (a replayed job never double-delivers). Unsubscribed
-- addresses are never sent. Delivery/open/click events are idempotent per external
-- id; test-mode sends never count toward stats.

create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  template_code text not null,
  language text not null default 'en',
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  audience_snapshot jsonb not null default '[]'::jsonb,
  test_mode boolean not null default false,
  batch_size integer not null default 100 check (batch_size > 0),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists email_campaigns_set_updated_at on email_campaigns;
create trigger email_campaigns_set_updated_at
before update on email_campaigns
for each row execute function set_updated_at();

create table if not exists email_campaign_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns (id) on delete cascade,
  batch_no integer not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'paused', 'failed')),
  recipient_count integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, batch_no)
);

create table if not exists email_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns (id) on delete cascade,
  batch_id uuid references email_campaign_batches (id) on delete set null,
  email text not null,
  language text not null default 'en',
  status text not null default 'queued' check (status in ('queued', 'sent', 'bounced', 'unsubscribed', 'failed', 'skipped')),
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists email_recipients_unique on email_recipients (campaign_id, email);
create index if not exists email_recipients_batch_idx on email_recipients (batch_id, status);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  recipient_id uuid references email_recipients (id) on delete cascade,
  type text not null check (type in ('delivered', 'open', 'click', 'bounce')),
  is_bot boolean not null default false,
  created_at timestamptz not null default now()
);

-- Webhook idempotency: a replayed provider event is a no-op.
create unique index if not exists email_events_external_unique on email_events (external_id);

create table if not exists email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);
