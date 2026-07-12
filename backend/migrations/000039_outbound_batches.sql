-- V2-07-18/19/20 — outbound batches, handoff with tracking-number writeback, and
-- tracking sync.
--
-- Outbound parcels are scanned into a batch (draft → loading). Confirming handoff
-- (handoff_pending → handed_off) requires a signed sheet or carrier receipt and
-- writes each carrier tracking number back onto its parcel, advancing the parcel
-- outbound → in_transit. A parcel may belong to at most one non-terminal batch:
-- consolidation_parcels.outbound_batch_id is that guard (set on load, cleared when
-- the batch is cancelled). Frozen batch state machine (V2-00-06).

create table if not exists outbound_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  carrier_id uuid references carriers (id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft', 'loading', 'handoff_pending', 'handed_off', 'completed', 'cancelled', 'exception'
  )),
  handoff_evidence jsonb not null default '[]'::jsonb,
  handed_off_at timestamptz,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_batches_status_idx on outbound_batches (status);

drop trigger if exists outbound_batches_set_updated_at on outbound_batches;
create trigger outbound_batches_set_updated_at
before update on outbound_batches
for each row execute function set_updated_at();

create table if not exists outbound_batch_parcels (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references outbound_batches (id) on delete cascade,
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  tracking_no text not null default '',
  loaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One membership row per (batch, parcel).
create unique index if not exists outbound_batch_parcels_unique on outbound_batch_parcels (batch_id, parcel_id);
create index if not exists outbound_batch_parcels_parcel_idx on outbound_batch_parcels (parcel_id);
