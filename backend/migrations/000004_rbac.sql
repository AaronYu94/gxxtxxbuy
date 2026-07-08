create table if not exists permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists permissions_set_updated_at on permissions;
create trigger permissions_set_updated_at
before update on permissions
for each row
execute function set_updated_at();

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists roles_set_updated_at on roles;
create trigger roles_set_updated_at
before update on roles
for each row
execute function set_updated_at();

create table if not exists role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_code text not null references permissions (code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table if not exists admin_user_roles (
  admin_user_id uuid not null references admin_users (id) on delete cascade,
  role_id uuid not null references roles (id) on delete cascade,
  granted_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (admin_user_id, role_id)
);

insert into permissions (code, description)
values
  ('*', 'Administrator wildcard permission.'),
  ('admin:read', 'Read admin console metadata.'),
  ('admin:manage', 'Manage admin users and roles.'),
  ('audit:read', 'Read audit logs.'),
  ('orders:read', 'Read purchase orders.'),
  ('orders:write', 'Update purchase orders.'),
  ('warehouse:read', 'Read warehouse queues.'),
  ('warehouse:write', 'Update warehouse and QC records.'),
  ('support:read', 'Read customer support context.'),
  ('support:write', 'Update support cases and customer notes.'),
  ('ops:policy:write', 'Update policy CMS and operational content.'),
  ('finance:wallet:write', 'Adjust wallet credit and financial records.'),
  ('risk:case:write', 'Create and update risk cases.'),
  ('shipping:read', 'Read parcel and shipping operations.'),
  ('shipping:write', 'Update parcel and shipping operations.')
on conflict (code) do update
set description = excluded.description;

insert into roles (code, name, description, is_system)
values
  ('procurement', 'Procurement', 'Can review and update purchase orders.', true),
  ('warehouse', 'Warehouse', 'Can receive warehouse items and upload QC.', true),
  ('support', 'Support', 'Can read customer context and handle support cases.', true),
  ('operations', 'Operations', 'Can manage policy CMS and shipping operations.', true),
  ('finance', 'Finance', 'Can adjust wallet and financial records.', true),
  ('risk', 'Risk', 'Can manage risk cases and review suspicious activity.', true),
  ('administrator', 'Administrator', 'Full administrative access.', true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_system = excluded.is_system;

insert into role_permissions (role_id, permission_code)
select roles.id, seed.permission_code
from roles
join (
  values
    ('procurement', 'orders:read'),
    ('procurement', 'orders:write'),
    ('warehouse', 'warehouse:read'),
    ('warehouse', 'warehouse:write'),
    ('support', 'orders:read'),
    ('support', 'support:read'),
    ('support', 'support:write'),
    ('operations', 'ops:policy:write'),
    ('operations', 'shipping:read'),
    ('operations', 'shipping:write'),
    ('finance', 'finance:wallet:write'),
    ('finance', 'audit:read'),
    ('risk', 'risk:case:write'),
    ('risk', 'audit:read'),
    ('administrator', '*')
) as seed(role_code, permission_code)
on seed.role_code = roles.code
on conflict do nothing;
