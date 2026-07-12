-- V2-07-17 — sealing / shipping-label / outbound evidence for a parcel.
--
-- After the international freight bill is paid (shipping_fee_due → outbound_pending)
-- the warehouse seals the box, attaches the shipping label, and photographs the
-- outbound state. Recording this evidence advances outbound_pending → outbound.
-- Seal and outbound photos are mandatory; an image-upload failure must not let a
-- parcel leave the warehouse unrecorded.

create table if not exists parcel_outbound_records (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references consolidation_parcels (id) on delete cascade,
  seal_photo_keys jsonb not null default '[]'::jsonb,
  label_key text not null default '',
  outbound_photo_keys jsonb not null default '[]'::jsonb,
  recorded_by_admin_id uuid references admin_users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One outbound record per parcel.
create unique index if not exists parcel_outbound_records_parcel_unique on parcel_outbound_records (parcel_id);
