create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,
  balance_cents integer not null default 0,
  currency text not null default 'USD',
  status text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (balance_cents >= 0)
);

create index if not exists wallets_status_idx on wallets (status);

drop trigger if exists wallets_set_updated_at on wallets;
create trigger wallets_set_updated_at
before update on wallets
for each row
execute function set_updated_at();

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  amount_cents integer not null check (amount_cents <> 0),
  balance_after_cents integer not null check (balance_after_cents >= 0),
  currency text not null default 'USD',
  reason text not null check (char_length(reason) > 0 and char_length(reason) <= 500),
  source_type text not null default 'admin_adjustment',
  source_id text not null default '',
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_idx on wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_wallet_idx on wallet_transactions (wallet_id, created_at desc);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled', 'archived')),
  coupon_type text not null default 'shipping' check (coupon_type in ('shipping', 'wallet_credit', 'welcome')),
  discount_type text not null default 'fixed' check (discount_type in ('fixed', 'percent', 'credit')),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  percent_off integer check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents >= 0),
  min_shipping_fee_cents integer not null default 0 check (min_shipping_fee_cents >= 0),
  currency text not null default 'USD',
  eligible_shipping_line_codes jsonb not null default '[]'::jsonb,
  combinable boolean not null default false,
  total_redemptions integer check (total_redemptions is null or total_redemptions >= 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_admin_user_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);

create index if not exists coupons_status_idx on coupons (status, starts_at, expires_at);

drop trigger if exists coupons_set_updated_at on coupons;
create trigger coupons_set_updated_at
before update on coupons
for each row
execute function set_updated_at();

create table if not exists user_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  coupon_id uuid not null references coupons (id) on delete restrict,
  status text not null default 'available' check (status in ('available', 'locked', 'used', 'expired', 'revoked')),
  redeemed_source text not null default 'code',
  discount_cents integer check (discount_cents is null or discount_cents >= 0),
  locked_parcel_id uuid references parcels (id) on delete set null,
  used_parcel_id uuid references parcels (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  locked_at timestamptz,
  used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, coupon_id)
);

create index if not exists user_coupons_user_status_idx on user_coupons (user_id, status, redeemed_at desc);
create index if not exists user_coupons_coupon_idx on user_coupons (coupon_id, status);

drop trigger if exists user_coupons_set_updated_at on user_coupons;
create trigger user_coupons_set_updated_at
before update on user_coupons
for each row
execute function set_updated_at();

create table if not exists welcome_gift_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,
  user_coupon_id uuid references user_coupons (id) on delete set null,
  claimed_at timestamptz not null default now()
);

create table if not exists checkout_coupon_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  parcel_id uuid not null references parcels (id) on delete cascade,
  user_coupon_id uuid not null references user_coupons (id) on delete restrict,
  coupon_id uuid not null references coupons (id) on delete restrict,
  status text not null default 'locked' check (status in ('locked', 'applied', 'rolled_back')),
  discount_cents integer not null check (discount_cents >= 0),
  original_final_fee_cents integer not null check (original_final_fee_cents >= 0),
  final_fee_cents integer not null check (final_fee_cents >= 0),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rolled_back_at timestamptz
);

create unique index if not exists checkout_coupon_applications_one_active_idx
on checkout_coupon_applications (parcel_id)
where status in ('locked', 'applied');

create index if not exists checkout_coupon_applications_user_idx
on checkout_coupon_applications (user_id, status, created_at desc);
