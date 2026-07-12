-- V2-04-10/11/13 procurement exceptions: price increase (with a surcharge to
-- collect) and availability (stockout / spec unpurchasable). An exception pauses
-- fulfillment via item_orders.exception_status; this table is the source of truth
-- for the case, its deadline, and its resolution. At most one OPEN exception can
-- exist per item at a time. Every user choice is appended to an immutable event
-- log (V2-04-11 keeps the full choice history).

create table if not exists order_exceptions (
  id uuid primary key default gen_random_uuid(),
  item_order_id uuid not null references item_orders (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  type text not null check (type in ('price_increase', 'availability', 'purchase_failed')),
  status text not null default 'open' check (status in ('open', 'resolved', 'cancelled', 'expired')),
  -- price_increase: backend-computed difference to collect. NULL for others.
  surcharge_cents bigint check (surcharge_cents is null or surcharge_cents > 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  detail jsonb not null default '{}'::jsonb,
  resolution text not null default '',
  deadline_at timestamptz not null,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one open exception per item (a new exception is a new record, never a
-- reused one).
create unique index if not exists order_exceptions_one_open
  on order_exceptions (item_order_id) where status = 'open';
create index if not exists order_exceptions_deadline_idx
  on order_exceptions (status, deadline_at);
create index if not exists order_exceptions_item_idx
  on order_exceptions (item_order_id, created_at desc);

drop trigger if exists order_exceptions_set_updated_at on order_exceptions;
create trigger order_exceptions_set_updated_at
before update on order_exceptions
for each row execute function set_updated_at();

-- Append-only user/ops choice history for an exception (V2-04-11).
create table if not exists order_exception_events (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references order_exceptions (id) on delete cascade,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists order_exception_events_idx
  on order_exception_events (exception_id, created_at asc);

drop trigger if exists order_exception_events_immutable on order_exception_events;
create trigger order_exception_events_immutable
before update on order_exception_events
for each row execute function catalog_reject_update();
