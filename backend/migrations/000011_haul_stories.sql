create table if not exists haul_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  parcel_id uuid references parcels (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 4000),
  privacy_level text not null default 'private' check (privacy_level in ('private', 'unlisted', 'public')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'hidden', 'withdrawn')),
  rejection_reason text not null default '',
  reviewed_by_admin_user_id uuid references admin_users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists haul_stories_user_idx on haul_stories (user_id, created_at desc);
create index if not exists haul_stories_review_idx on haul_stories (review_status, created_at desc);
-- Public feed lookups only ever touch approved + public rows.
create index if not exists haul_stories_public_idx on haul_stories (privacy_level, review_status) where privacy_level = 'public' and review_status = 'approved';

drop trigger if exists haul_stories_set_updated_at on haul_stories;
create trigger haul_stories_set_updated_at
before update on haul_stories
for each row
execute function set_updated_at();

-- B7-08/B7-09: content moderation permission for the review queue and actions.
insert into permissions (code, description)
values ('content:review:write', 'Review and moderate user-generated content.')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_id, permission_code)
select roles.id, seed.permission_code
from roles
join (
  values
    ('support', 'content:review:write'),
    ('operations', 'content:review:write'),
    ('risk', 'content:review:write')
) as seed(role_code, permission_code)
on seed.role_code = roles.code
on conflict do nothing;
