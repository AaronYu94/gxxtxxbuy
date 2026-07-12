-- V2-10-05/06 — homepage carousel banners.
--
-- A banner targets language + (optional) country and carries all three device
-- images (desktop / tablet / mobile). It can only be PUBLISHED when every image is
-- present and the redirect link is safe. Front-of-house reads only published,
-- in-window banners, filtered by language/country/device and ordered by sort_order.

create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  language text not null default 'en',
  country_code text not null default '',
  desktop_image_key text not null default '',
  tablet_image_key text not null default '',
  mobile_image_key text not null default '',
  link_url text not null default '',
  sort_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists banners_read_idx on banners (status, language, country_code, sort_order);

drop trigger if exists banners_set_updated_at on banners;
create trigger banners_set_updated_at
before update on banners
for each row execute function set_updated_at();
