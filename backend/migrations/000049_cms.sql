-- V2-10-07/11 — multilingual email templates + policy/announcement/config version
-- center.
--
-- Email templates are versioned per (code, language); publishing requires every
-- {{variable}} used to be declared. A sent email records the template code +
-- version + language so history keeps the exact template that was sent. Missing a
-- language falls back to the default language at read time.
--
-- The config version center holds multilingual agreements / announcements /
-- notices / public config as versioned documents. Only a super admin writes; each
-- published version carries a reason + effective time; historical business keeps
-- referencing the version it used.

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  language text not null default 'en',
  subject text not null default '',
  body text not null default '',
  variables jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active published version per (code, language).
create unique index if not exists email_templates_published_unique
  on email_templates (code, language) where status = 'published';
create unique index if not exists email_templates_version_unique on email_templates (code, language, version);

drop trigger if exists email_templates_set_updated_at on email_templates;
create trigger email_templates_set_updated_at
before update on email_templates
for each row execute function set_updated_at();

create table if not exists config_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('agreement', 'announcement', 'notice', 'public_config')),
  doc_key text not null,
  language text not null default 'en',
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  active boolean not null default false,
  reason text not null default '',
  effective_at timestamptz not null default now(),
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists config_documents_version_unique on config_documents (kind, doc_key, language, version);
create unique index if not exists config_documents_active_unique on config_documents (kind, doc_key, language) where active;
create index if not exists config_documents_read_idx on config_documents (kind, doc_key, language, active);
