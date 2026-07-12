-- V2-04-06 append-only status history for item sub-orders. Every fulfillment or
-- exception transition records who / when / why plus the request id and the
-- idempotency key. The current status columns on item_orders are a cache of the
-- latest transition here; the history is never replaced by them (V2-00-06).
-- Rows are immutable — reuse the catalog immutability guard from 000016.

create table if not exists item_order_status_history (
  id uuid primary key default gen_random_uuid(),
  item_order_id uuid not null references item_orders (id) on delete cascade,
  field text not null check (field in ('fulfillment', 'exception')),
  from_status text not null,
  to_status text not null,
  action text not null,
  reason text not null default '',
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  actor_id uuid,
  actor_role text not null default '',
  -- Same idempotency key applied twice is a no-op, never a duplicate transition.
  idempotency_key text,
  request_id text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists item_order_status_history_item_idx
  on item_order_status_history (item_order_id, created_at asc);
create unique index if not exists item_order_status_history_idem_idx
  on item_order_status_history (item_order_id, idempotency_key)
  where idempotency_key is not null;

drop trigger if exists item_order_status_history_immutable on item_order_status_history;
create trigger item_order_status_history_immutable
before update on item_order_status_history
for each row execute function catalog_reject_update();
