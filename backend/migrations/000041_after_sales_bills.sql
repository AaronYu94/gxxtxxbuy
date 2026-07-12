-- V2-08-06 — after-sales fee bills (user-responsible return freight + operation +
-- packing). Follows the frozen fee-bill state machine (draft → payable → paid;
-- cancelled; refund_pending → refunded). The fee sources are snapshotted into
-- `breakdown` at creation so a later config change never mutates an issued bill.

create table if not exists after_sales_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null default 'return_fee' check (kind in ('return_fee')),
  status text not null default 'payable' check (status in (
    'draft', 'payable', 'paid', 'cancelled', 'refund_pending', 'refunded'
  )),
  subtotal_cny_minor bigint not null default 0 check (subtotal_cny_minor >= 0),
  total_cny_minor bigint not null default 0 check (total_cny_minor >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  ledger_tx_id uuid references ledger_transactions (id),
  idempotency_key text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one non-cancelled bill of each kind per after-sales order.
create unique index if not exists after_sales_bills_kind_active_unique
  on after_sales_bills (after_sales_id, kind) where status <> 'cancelled';
create index if not exists after_sales_bills_user_idx on after_sales_bills (user_id, created_at desc);

drop trigger if exists after_sales_bills_set_updated_at on after_sales_bills;
create trigger after_sales_bills_set_updated_at
before update on after_sales_bills
for each row execute function set_updated_at();
