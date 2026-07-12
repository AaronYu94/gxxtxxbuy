-- V2-06-05/06/07 QC tasks + fixed photo templates. One standard QC task per
-- item. A task is claimed by exactly one operator (concurrent claim → one wins);
-- the four standard photo slots (front/back/side/label) must all be present to
-- complete. Re-shoots keep history (a new version per slot), so the latest photo
-- per slot is current while older ones remain (V2-06-10).

create table if not exists qc_tasks (
  id uuid primary key default gen_random_uuid(),
  item_order_id uuid not null references item_orders (id) on delete cascade,
  inbound_package_id uuid references inbound_packages (id) on delete set null,
  user_id uuid not null references users (id) on delete cascade,
  type text not null default 'standard' check (type in ('standard', 'extra_photo', 'detailed')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'in_progress', 'exception', 'completed', 'cancelled')),
  assignee_admin_id uuid references admin_users (id) on delete set null,
  claimed_at timestamptz,
  unpack_required boolean not null default false,
  wait_hours integer not null default 0 check (wait_hours >= 0),
  exception_note text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qc_tasks_item_standard_unique
  on qc_tasks (item_order_id) where type = 'standard';
create index if not exists qc_tasks_status_idx on qc_tasks (status, created_at desc);
create index if not exists qc_tasks_assignee_idx on qc_tasks (assignee_admin_id);

drop trigger if exists qc_tasks_set_updated_at on qc_tasks;
create trigger qc_tasks_set_updated_at
before update on qc_tasks
for each row execute function set_updated_at();

-- Named qc_task_photos to avoid colliding with the V1 warehouse qc_photos table
-- (migration 000007), which has a different schema and is still used by the
-- warehouse/admin repositories. This WMS/QC-task photo table is a separate concern.
create table if not exists qc_task_photos (
  id uuid primary key default gen_random_uuid(),
  qc_task_id uuid not null references qc_tasks (id) on delete cascade,
  slot text not null check (slot in ('front', 'back', 'side', 'label')),
  storage_key text not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists qc_task_photos_task_idx on qc_task_photos (qc_task_id, slot, version desc);
