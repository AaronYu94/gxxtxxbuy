-- V2-08-01/02/03 — after-sales (returns & refunds) order, immutable status history,
-- and attachments.
--
-- An after-sales order is opened against one item sub-order (代购 only; forwarded
-- goods are out of scope for auto-returns). Eligibility is the 5-day window from
-- QC official warehousing (inventory_units.return_deadline_at). The frozen
-- after-sales state machine (V2-00-06) governs `status`; every transition is
-- appended to after_sales_history, which is append-only (the current-status column
-- on the order never replaces the history).

create table if not exists after_sales_orders (
  id uuid primary key default gen_random_uuid(),
  as_no text not null unique,
  item_order_id uuid not null references item_orders (id) on delete cascade,
  inventory_unit_id uuid references inventory_units (id) on delete set null,
  user_id uuid not null references users (id) on delete cascade,
  status text not null default 'purchase_review_pending' check (status in (
    'purchase_review_pending', 'purchase_reviewing', 'customer_material_pending', 'return_fee_due',
    'warehouse_picking_pending', 'return_verifying', 'return_packing', 'merchant_return_pending',
    'returned_to_merchant', 'merchant_refund_pending', 'platform_refund_pending',
    'completed', 'rejected', 'closed', 'exception'
  )),
  reason text not null default '',
  description text not null default '',
  quantity integer not null default 1 check (quantity > 0),
  -- Set by procurement review (V2-08-04): who is at fault, who pays return freight.
  responsible_party text check (responsible_party is null or responsible_party in ('seller', 'user')),
  freight_party text check (freight_party is null or freight_party in ('seller', 'user')),
  reject_reason text not null default '',
  -- Refund accounting (V2-08-10/11): merchant refund + final platform refund.
  merchant_refund_cny_minor bigint not null default 0 check (merchant_refund_cny_minor >= 0),
  merchant_deduction_cny_minor bigint not null default 0 check (merchant_deduction_cny_minor >= 0),
  platform_refund_cny_minor bigint not null default 0 check (platform_refund_cny_minor >= 0),
  return_fee_bill_id uuid,
  refund_ledger_tx_id uuid references ledger_transactions (id),
  current_owner_role text not null default 'procurement',
  deadline_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active after-sales order per item (a closed/rejected one lets a new one open).
create unique index if not exists after_sales_active_item_unique
  on after_sales_orders (item_order_id) where status not in ('completed', 'rejected', 'closed');
create index if not exists after_sales_user_idx on after_sales_orders (user_id, created_at desc);
create index if not exists after_sales_status_idx on after_sales_orders (status);

drop trigger if exists after_sales_orders_set_updated_at on after_sales_orders;
create trigger after_sales_orders_set_updated_at
before update on after_sales_orders
for each row execute function set_updated_at();

-- Append-only status/action history.
create table if not exists after_sales_history (
  id uuid primary key default gen_random_uuid(),
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  from_status text not null default '',
  to_status text not null default '',
  action text not null,
  actor_type text not null,
  actor_id uuid,
  actor_role text not null default '',
  reason text not null default '',
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists after_sales_history_order_idx on after_sales_history (after_sales_id, created_at asc);

-- History rows are immutable once written: an UPDATE is rejected (SQLSTATE 23001).
-- (DELETE is left to ON DELETE CASCADE so account deletion / anonymization can
-- still remove a whole order; app code never deletes individual history rows.)
create or replace function after_sales_history_reject_mutation() returns trigger as $$
begin
  raise exception 'after_sales_history rows are immutable' using errcode = '23001';
end;
$$ language plpgsql;

drop trigger if exists after_sales_history_no_update on after_sales_history;
create trigger after_sales_history_no_update
before update on after_sales_history
for each row execute function after_sales_history_reject_mutation();

-- Evidence (user), supplementary materials, return QC photos, merchant receipts.
create table if not exists after_sales_attachments (
  id uuid primary key default gen_random_uuid(),
  after_sales_id uuid not null references after_sales_orders (id) on delete cascade,
  kind text not null check (kind in ('evidence', 'material', 'return_qc', 'merchant_receipt', 'ship_back')),
  photo_keys jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_by_type text not null default 'user',
  created_by_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists after_sales_attachments_order_idx on after_sales_attachments (after_sales_id, created_at asc);
