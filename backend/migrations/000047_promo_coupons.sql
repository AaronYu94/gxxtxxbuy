-- V2-10-01/02/03/04 — international-shipping coupons (V2). Distinct from the legacy
-- V1 coupons (000009); these bind to consolidation parcels and the freight bill.
--
-- A coupon is for INTERNATIONAL SHIPPING only. Once activated, its key discount
-- rules are frozen (edits that would rewrite history are rejected); only quota and
-- enable/disable may change. Grants are quota-bounded and idempotent per event; a
-- reservation locks one coupon to one parcel and is settled on payment (or released
-- on failure/cancel), with a partial unique index guaranteeing one active
-- reservation per parcel and one live grant per coupon-hold.

create table if not exists promo_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  discount_type text not null check (discount_type in ('fixed', 'percent', 'threshold')),
  -- fixed: fixed_value_minor off; percent: percent_bps off (capped by max_discount);
  -- threshold: threshold_discount_minor off when subtotal >= threshold_min_minor.
  fixed_value_minor bigint not null default 0 check (fixed_value_minor >= 0),
  percent_bps integer not null default 0 check (percent_bps >= 0 and percent_bps <= 10000),
  threshold_min_minor bigint not null default 0 check (threshold_min_minor >= 0),
  threshold_discount_minor bigint not null default 0 check (threshold_discount_minor >= 0),
  max_discount_minor bigint not null default 0 check (max_discount_minor >= 0),
  eligible_countries jsonb not null default '[]'::jsonb,
  eligible_route_codes jsonb not null default '[]'::jsonb,
  total_quota integer check (total_quota is null or total_quota >= 0),
  granted_count integer not null default 0 check (granted_count >= 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  claim_starts_at timestamptz,
  claim_ends_at timestamptz,
  use_starts_at timestamptz,
  use_ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'disabled', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists promo_coupons_status_idx on promo_coupons (status);

drop trigger if exists promo_coupons_set_updated_at on promo_coupons;
create trigger promo_coupons_set_updated_at
before update on promo_coupons
for each row execute function set_updated_at();

create table if not exists promo_coupon_grants (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references promo_coupons (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  source text not null default 'grant' check (source in ('grant', 'redeem_code', 'signup')),
  status text not null default 'available' check (status in ('available', 'reserved', 'used', 'expired', 'revoked')),
  reserved_parcel_id uuid references consolidation_parcels (id) on delete set null,
  used_parcel_id uuid references consolidation_parcels (id) on delete set null,
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent grant events (signup / one-shot grant) never double-issue.
create unique index if not exists promo_coupon_grants_idem_unique on promo_coupon_grants (idempotency_key) where idempotency_key is not null;
create index if not exists promo_coupon_grants_user_idx on promo_coupon_grants (user_id, status);
-- One live reservation per parcel (one coupon per shipment).
create unique index if not exists promo_coupon_grants_parcel_unique on promo_coupon_grants (reserved_parcel_id) where reserved_parcel_id is not null and status = 'reserved';

drop trigger if exists promo_coupon_grants_set_updated_at on promo_coupon_grants;
create trigger promo_coupon_grants_set_updated_at
before update on promo_coupon_grants
for each row execute function set_updated_at();
