-- V2-07-08/09/15 — parcel fee bills.
--
-- The packing-fee bill and the international-freight bill are TWO SEPARATE bills
-- (frozen fund-object rule): `kind` distinguishes them. A bill follows the frozen
-- fee-bill state machine: draft -> payable -> paid; cancelled; refund_pending ->
-- refunded. Membership/coupon discounts (V2-07-09) are recorded on the bill.

create table if not exists parcel_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('packing', 'shipping')),
  status text not null default 'payable' check (status in (
    'draft', 'payable', 'paid', 'cancelled', 'refund_pending', 'refunded'
  )),
  subtotal_cny_minor bigint not null default 0 check (subtotal_cny_minor >= 0),
  membership_discount_cny_minor bigint not null default 0 check (membership_discount_cny_minor >= 0),
  coupon_discount_cny_minor bigint not null default 0 check (coupon_discount_cny_minor >= 0),
  coupon_code text not null default '',
  total_cny_minor bigint not null default 0 check (total_cny_minor >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  ledger_tx_id uuid references ledger_transactions (id),
  refund_ledger_tx_id uuid references ledger_transactions (id),
  idempotency_key text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one non-cancelled bill of each kind per parcel.
create unique index if not exists parcel_bills_kind_active_unique
  on parcel_bills (parcel_id, kind) where status <> 'cancelled';
create index if not exists parcel_bills_user_idx on parcel_bills (user_id, created_at desc);

drop trigger if exists parcel_bills_set_updated_at on parcel_bills;
create trigger parcel_bills_set_updated_at
before update on parcel_bills
for each row execute function set_updated_at();
