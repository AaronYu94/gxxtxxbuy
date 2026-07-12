-- V2-07-11/12/13 — picking task, item-by-item scan, and the pre-pack review lock.
--
-- When the warehouse accepts a paid parcel (warehouse_acceptance_pending → picking)
-- a picking task is created. The operator scans each reserved unit's stock number
-- one at a time; only when every unit is scanned can packing start (picking →
-- packing), which is the lock point after which the user can no longer cancel or
-- edit the parcel (frozen rule).

create table if not exists picking_tasks (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'claimed', 'in_progress', 'reviewing', 'completed', 'exception'
  )),
  assignee_admin_id uuid references admin_users (id) on delete set null,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One picking task per parcel.
create unique index if not exists picking_tasks_parcel_unique on picking_tasks (parcel_id);
create index if not exists picking_tasks_status_idx on picking_tasks (status);

drop trigger if exists picking_tasks_set_updated_at on picking_tasks;
create trigger picking_tasks_set_updated_at
before update on picking_tasks
for each row execute function set_updated_at();

-- V2-07-12 — per-item scan progress on the reservation line.
alter table consolidation_parcel_items add column if not exists picked_at timestamptz;
alter table consolidation_parcel_items add column if not exists picked_by_admin_id uuid references admin_users (id) on delete set null;
