-- V2-10-12..16 — customer support conversations, messages, and presale→aftersales
-- links.
--
-- A conversation threads email + live-chat messages in stable order. Inbound
-- messages are de-duplicated by their provider external id. Attachments are
-- referenced (private storage keys), never inlined. Claiming is single-owner
-- (concurrent claims: one wins). Support may LINK a conversation to an after-sales
-- order but can never change after-sales state. Response metrics derive from
-- message roles + event times, so replaying a message never changes them.

create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '',
  channel text not null default 'email' check (channel in ('email', 'live_chat')),
  status text not null default 'open' check (status in ('open', 'claimed', 'pending', 'resolved', 'closed')),
  assignee_admin_id uuid references admin_users (id) on delete set null,
  requester_user_id uuid references users (id) on delete set null,
  requester_email text not null default '',
  related_type text not null default '' check (related_type in ('', 'order', 'parcel', 'after_sales')),
  related_id text not null default '',
  first_response_at timestamptz,
  resolved_at timestamptz,
  reopened_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_conversations_status_idx on support_conversations (status, created_at desc);
create index if not exists support_conversations_assignee_idx on support_conversations (assignee_admin_id, status);

drop trigger if exists support_conversations_set_updated_at on support_conversations;
create trigger support_conversations_set_updated_at
before update on support_conversations
for each row execute function set_updated_at();

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  author_type text not null default 'user' check (author_type in ('user', 'admin', 'system')),
  author_admin_id uuid references admin_users (id) on delete set null,
  body text not null default '',
  attachment_keys jsonb not null default '[]'::jsonb,
  external_id text,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Inbound dedup: a provider message is threaded at most once.
create unique index if not exists support_messages_external_unique on support_messages (external_id) where external_id is not null;
create index if not exists support_messages_conversation_idx on support_messages (conversation_id, event_at asc, created_at asc);

create table if not exists support_status_history (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations (id) on delete cascade,
  from_status text not null default '',
  to_status text not null,
  action text not null,
  actor_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists support_after_sales_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations (id) on delete cascade,
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (conversation_id, after_sales_id)
);
