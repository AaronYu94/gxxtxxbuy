-- V2-06-08/09/10 paid QC add-ons and QC exceptions.
--
-- qc_purchases: extra photos (1 CNY each) or a detailed inspection (5 CNY per
-- item). Quantity + amount are backend-authoritative; an idempotency key makes a
-- repeated purchase a no-op; refunds are an explicit status.
-- qc_exceptions: an unresolved exception blocks normal warehousing (V2-06-11).

create table if not exists qc_purchases (
  id uuid primary key default gen_random_uuid(),
  item_order_id uuid not null references item_orders (id) on delete cascade,
  qc_task_id uuid references qc_tasks (id) on delete set null,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('extra_photo', 'detailed')),
  quantity integer not null check (quantity > 0),
  amount_cny_minor bigint not null check (amount_cny_minor > 0),
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  ledger_tx_id uuid references ledger_transactions (id),
  idempotency_key text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qc_purchases_idem_unique
  on qc_purchases (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists qc_purchases_item_idx on qc_purchases (item_order_id, created_at desc);

drop trigger if exists qc_purchases_set_updated_at on qc_purchases;
create trigger qc_purchases_set_updated_at
before update on qc_purchases
for each row execute function set_updated_at();

create table if not exists qc_exceptions (
  id uuid primary key default gen_random_uuid(),
  qc_task_id uuid not null references qc_tasks (id) on delete cascade,
  type text not null,
  note text not null default '',
  photo_keys jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  resolved_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists qc_exceptions_task_idx on qc_exceptions (qc_task_id, created_at desc);
