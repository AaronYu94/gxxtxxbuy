-- V2-04-14 merchant dispatch registration. The buyer records the merchant's
-- domestic carrier + tracking number + ship time and the item moves to
-- seller_dispatched. A domestic tracking number must not bind a DIFFERENT user's
-- order (guarded in the service); corrections keep history and need permission.

alter table item_orders add column if not exists carrier text not null default '';
alter table item_orders add column if not exists domestic_tracking_no text not null default '';
alter table item_orders add column if not exists dispatched_at timestamptz;

create index if not exists item_orders_tracking_idx
  on item_orders (domestic_tracking_no) where domestic_tracking_no <> '';
