-- Social login — links a third-party identity (Google / Apple / Discord / Facebook
-- / GitHub / Microsoft) to a user. A provider identity is unique per provider, and
-- a user may link at most one identity per provider. Sign-in finds the identity;
-- if none exists it links to a user with the same verified email, otherwise it
-- creates a new (email-verified, passwordless) account.

create table if not exists oauth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null check (provider in ('google', 'apple', 'discord', 'facebook', 'github', 'microsoft')),
  provider_user_id text not null,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One identity per (provider, provider_user_id); one link per (user, provider).
create unique index if not exists oauth_identities_provider_unique on oauth_identities (provider, provider_user_id);
create unique index if not exists oauth_identities_user_provider_unique on oauth_identities (user_id, provider);
create index if not exists oauth_identities_user_idx on oauth_identities (user_id);

drop trigger if exists oauth_identities_set_updated_at on oauth_identities;
create trigger oauth_identities_set_updated_at
before update on oauth_identities
for each row execute function set_updated_at();
