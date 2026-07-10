-- V2 identity, permission, device trust, MFA, and immutable audit foundation.

alter table users drop constraint if exists users_status_check;
alter table users drop constraint if exists users_v2_status_check;
alter table users alter column status drop default;
update users
set status = case status
  when 'active' then 'normal'
  when 'disabled' then 'risk_locked'
  when 'deleted' then 'banned'
  else status
end;
alter table users alter column status set default 'normal';
alter table users add constraint users_v2_status_check
  check (status in ('normal', 'risk_locked', 'banned'));
alter table users
  add column if not exists email_verified_at timestamptz,
  add column if not exists phone text,
  add column if not exists country_code text,
  add column if not exists default_locale text not null default 'en-US',
  add column if not exists default_currency text not null default 'USD',
  add column if not exists security_locked_until timestamptz,
  add column if not exists anonymized_at timestamptz;
-- Existing accounts passed the legacy registration contract; preserve access.
update users set email_verified_at = created_at where email_verified_at is null;

alter table admin_users drop constraint if exists admin_users_status_check;
alter table admin_users drop constraint if exists admin_users_v2_status_check;
alter table admin_users alter column status drop default;
update admin_users
set status = case when status = 'active' then 'enabled' else 'disabled' end;
alter table admin_users alter column status set default 'enabled';
alter table admin_users add constraint admin_users_v2_status_check
  check (status in ('enabled', 'disabled'));
alter table admin_users
  add column if not exists employee_no text,
  add column if not exists department_code text,
  add column if not exists organization_code text,
  add column if not exists totp_secret_encrypted text,
  add column if not exists totp_enabled_at timestamptz,
  add column if not exists totp_last_counter bigint;
create unique index if not exists admin_users_employee_no_unique
  on admin_users (employee_no) where employee_no is not null and deleted_at is null;

alter table sessions
  add column if not exists device_hash text,
  add column if not exists authenticated_at timestamptz,
  add column if not exists absolute_expires_at timestamptz,
  add column if not exists mfa_verified_at timestamptz;
update sessions
set authenticated_at = coalesce(authenticated_at, created_at),
    absolute_expires_at = coalesce(
      absolute_expires_at,
      case when actor_type = 'admin' then created_at + interval '24 hours' else refresh_expires_at end
    );
alter table sessions alter column authenticated_at set default now();
create index if not exists sessions_absolute_expires_at_idx on sessions (absolute_expires_at);

create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('registration', 'device_reverify', 'email_change')),
  token_hash text not null unique,
  device_hash text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_tokens_user_idx
  on email_verification_tokens (user_id, purpose, created_at desc);

create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  device_hash text not null,
  label text not null default '',
  trusted_at timestamptz,
  trust_revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_hash)
);

create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'admin')),
  principal_hash text not null,
  ip_hash text,
  device_hash text,
  succeeded boolean not null,
  failure_reason text,
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_lookup_idx
  on login_attempts (actor_type, principal_hash, attempted_at desc);

create table if not exists admin_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users (id) on delete cascade,
  challenge_token_hash text not null unique,
  challenge_type text not null check (challenge_type in ('totp_setup', 'login')),
  pending_totp_secret_encrypted text,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_hash text,
  device_hash text,
  created_at timestamptz not null default now()
);

create table if not exists admin_totp_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users (id) on delete cascade,
  code_hash text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists admin_reauth_challenges (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  challenge_token_hash text not null unique,
  action text not null,
  reason text not null,
  resource_type text,
  resource_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into permissions (code, description)
values
  ('*', 'Full administrative access.'),
  ('admin:read', 'Read admin account metadata.'),
  ('admin:manage', 'Manage admin employees and roles.'),
  ('audit:read', 'Read immutable audit logs.'),
  ('orders:read', 'Read purchase orders.'),
  ('orders:write', 'Update purchase orders.'),
  ('orders:controlled_transition', 'Perform controlled order transitions.'),
  ('procurement:read', 'Read procurement work.'),
  ('procurement:write', 'Update assigned procurement work.'),
  ('procurement:reassign', 'Reassign procurement work in the organization.'),
  ('warehouse:read', 'Read warehouse queues.'),
  ('warehouse:write', 'Update warehouse and QC records.'),
  ('warehouse:correct', 'Perform controlled warehouse corrections.'),
  ('support:read', 'Read customer support context.'),
  ('support:write', 'Update support cases and notes.'),
  ('users:search', 'Search users by exact identifiers.'),
  ('finance:wallet:write', 'Post approved wallet entries.'),
  ('finance:read', 'Read finance records.'),
  ('finance:write', 'Update finance workflows.'),
  ('finance:adjust', 'Request or approve controlled adjustments.'),
  ('finance:lock', 'Apply finance safety locks.'),
  ('campaign:read', 'Read campaigns and operational content.'),
  ('campaign:write', 'Manage campaigns and operational content.'),
  ('referral:read', 'Read referral operations.'),
  ('referral:write', 'Manage referral operations.'),
  ('ops:policy:write', 'Update policy CMS and operational content.'),
  ('content:review:write', 'Review user-generated content.'),
  ('risk:case:write', 'Create and update risk cases.'),
  ('shipping:read', 'Read parcel and shipping operations.'),
  ('shipping:write', 'Update parcel and shipping operations.'),
  ('config:read', 'Read versioned configuration.'),
  ('config:write', 'Manage versioned configuration.'),
  ('export:write', 'Create sensitive exports.')
on conflict (code) do update set description = excluded.description;

insert into roles (code, name, description, is_system)
values
  ('super_admin', 'Super Admin', 'Full platform administration with re-authentication for high-risk operations.', true),
  ('procurement_agent', 'Procurement Agent', 'Handles assigned procurement work.', true),
  ('procurement_lead', 'Procurement Lead', 'Leads procurement within an organization.', true),
  ('support_agent', 'Support Agent', 'Handles exact-search customer support work.', true),
  ('warehouse_operator', 'Warehouse Operator', 'Handles receiving, QC, packing, and outbound work.', true),
  ('warehouse_lead', 'Warehouse Lead', 'Leads warehouse operations and controlled corrections.', true),
  ('finance_operator', 'Finance Operator', 'Handles wallet, refund, and finance risk work.', true),
  ('campaign_operator', 'Campaign Operator', 'Manages campaigns and policy content.', true),
  ('referral_operator', 'Referral Operator', 'Manages referral and promoter operations.', true)
on conflict (code) do update
set name = excluded.name, description = excluded.description, is_system = true;

-- Preserve one deterministic legacy assignment while replacing old role codes.
with mapped as (
  select aur.admin_user_id,
         target.id as role_id,
         aur.granted_by_admin_id,
         aur.created_at,
         row_number() over (
           partition by aur.admin_user_id
           order by case old_role.code when 'administrator' then 0 else 1 end, aur.created_at, aur.role_id
         ) as rn
  from admin_user_roles aur
  join roles old_role on old_role.id = aur.role_id
  join roles target on target.code = case old_role.code
    when 'administrator' then 'super_admin'
    when 'procurement' then 'procurement_agent'
    when 'warehouse' then 'warehouse_operator'
    when 'support' then 'support_agent'
    when 'operations' then 'campaign_operator'
    when 'finance' then 'finance_operator'
    when 'risk' then 'finance_operator'
    else old_role.code
  end
)
insert into admin_user_roles (admin_user_id, role_id, granted_by_admin_id, created_at)
select admin_user_id, role_id, granted_by_admin_id, created_at from mapped where rn = 1
on conflict do nothing;

delete from admin_user_roles aur
using roles r
where aur.role_id = r.id
  and r.code not in (
    'super_admin', 'procurement_agent', 'procurement_lead', 'support_agent',
    'warehouse_operator', 'warehouse_lead', 'finance_operator',
    'campaign_operator', 'referral_operator'
  );

with ranked as (
  select admin_user_id, role_id,
         row_number() over (partition by admin_user_id order by created_at, role_id) as rn
  from admin_user_roles
)
delete from admin_user_roles aur
using ranked r
where aur.admin_user_id = r.admin_user_id and aur.role_id = r.role_id and r.rn > 1;

create unique index if not exists admin_user_roles_one_role_unique
  on admin_user_roles (admin_user_id);

delete from role_permissions rp
using roles r
where rp.role_id = r.id
  and r.code in (
    'super_admin', 'procurement_agent', 'procurement_lead', 'support_agent',
    'warehouse_operator', 'warehouse_lead', 'finance_operator',
    'campaign_operator', 'referral_operator'
  );

insert into role_permissions (role_id, permission_code)
select r.id, seed.permission_code
from roles r
join (values
  ('super_admin', '*'),
  ('procurement_agent', 'orders:read'), ('procurement_agent', 'orders:write'),
  ('procurement_agent', 'procurement:read'), ('procurement_agent', 'procurement:write'),
  ('procurement_lead', 'orders:read'), ('procurement_lead', 'orders:write'),
  ('procurement_lead', 'orders:controlled_transition'), ('procurement_lead', 'procurement:read'),
  ('procurement_lead', 'procurement:write'), ('procurement_lead', 'procurement:reassign'),
  ('support_agent', 'orders:read'), ('support_agent', 'support:read'),
  ('support_agent', 'support:write'), ('support_agent', 'users:search'),
  ('warehouse_operator', 'warehouse:read'), ('warehouse_operator', 'warehouse:write'),
  ('warehouse_operator', 'shipping:read'), ('warehouse_operator', 'shipping:write'),
  ('warehouse_lead', 'warehouse:read'), ('warehouse_lead', 'warehouse:write'),
  ('warehouse_lead', 'warehouse:correct'), ('warehouse_lead', 'shipping:read'),
  ('warehouse_lead', 'shipping:write'),
  ('finance_operator', 'finance:wallet:write'), ('finance_operator', 'finance:read'),
  ('finance_operator', 'finance:write'), ('finance_operator', 'finance:adjust'),
  ('finance_operator', 'finance:lock'), ('finance_operator', 'audit:read'),
  ('campaign_operator', 'campaign:read'), ('campaign_operator', 'campaign:write'),
  ('campaign_operator', 'ops:policy:write'), ('campaign_operator', 'users:search'),
  ('referral_operator', 'referral:read'), ('referral_operator', 'referral:write'),
  ('referral_operator', 'users:search')
) as seed(role_code, permission_code) on seed.role_code = r.code
on conflict do nothing;

delete from roles
where code not in (
  'super_admin', 'procurement_agent', 'procurement_lead', 'support_agent',
  'warehouse_operator', 'warehouse_lead', 'finance_operator',
  'campaign_operator', 'referral_operator'
);

create or replace function prevent_audit_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs are immutable';
end;
$$;

drop trigger if exists audit_logs_prevent_update on audit_logs;
create trigger audit_logs_prevent_update
before update on audit_logs for each row execute function prevent_audit_log_mutation();
drop trigger if exists audit_logs_prevent_delete on audit_logs;
create trigger audit_logs_prevent_delete
before delete on audit_logs for each row execute function prevent_audit_log_mutation();
