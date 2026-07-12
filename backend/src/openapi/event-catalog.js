// V2-12-07 — the domain event catalog. Every significant business event is listed
// here with its trigger and a payload example, so integrators (and the notification
// / commission / analytics consumers) have a single source of truth.
export const EVENT_CATALOG = Object.freeze([
  { event: "order.paid", trigger: "parent order payment settled", example: { order_id: "uuid", order_no: "GO-PO-...", total_cents: 12000 } },
  { event: "item.purchased", trigger: "procurement confirms a buy", example: { item_order_id: "uuid", actual_order_no: "..." } },
  { event: "item.dispatched", trigger: "seller ships the item", example: { item_order_id: "uuid", carrier: "SF", tracking_no: "..." } },
  { event: "inbound.arrived", trigger: "warehouse scans an arrival", example: { inbound_id: "uuid", matched: true } },
  { event: "qc.completed", trigger: "QC completed + officially warehoused", example: { qc_task_id: "uuid", stock_no: "GO-STOCK-..." } },
  { event: "parcel.packing_started", trigger: "warehouse starts packing (cancel lock)", example: { parcel_id: "uuid" } },
  { event: "parcel.shipping_fee_paid", trigger: "user pays international shipping", example: { parcel_id: "uuid", bill_id: "uuid" } },
  { event: "parcel.outbound", trigger: "seal/label/outbound recorded", example: { parcel_id: "uuid" } },
  { event: "batch.handed_off", trigger: "outbound batch handed to carrier", example: { batch_id: "uuid", tracking_writeback: true } },
  { event: "parcel.delivered", trigger: "tracking sync marks delivered (signed)", example: { parcel_id: "uuid" } },
  { event: "commission.generated", trigger: "signed parcel generates promoter commission", example: { commission_id: "uuid", promoter_user_id: "uuid", amount_cny_minor: 14000 } },
  { event: "commission.clawed_back", trigger: "refund dispute claws back commission", example: { parcel_id: "uuid", amount_cny_minor: 14000 } },
  { event: "after_sales.opened", trigger: "user opens a return", example: { after_sales_id: "uuid", status: "purchase_review_pending" } },
  { event: "after_sales.refund_completed", trigger: "finance wallet refund executed", example: { after_sales_id: "uuid", amount_cny_minor: 10000 } },
  { event: "wallet.topup_succeeded", trigger: "top-up provider webhook succeeded", example: { top_up_id: "uuid", amount_minor: 100000 } },
  { event: "wallet.withdrawal_paid", trigger: "withdrawal executed", example: { withdrawal_id: "uuid" } },
  { event: "account.locked", trigger: "super-admin approves an account lock", example: { user_id: "uuid", to_status: "risk_locked" } },
  { event: "account.anonymized", trigger: "account deletion processed", example: { user_id: "uuid" } }
]);

// Every error-code family used across the API (documented for integrators).
export const ERROR_CODE_FAMILIES = Object.freeze([
  "empty_query", "version_conflict", "already_reserved", "not_eligible", "insufficient_available",
  "frozen_rule", "quota_exhausted", "per_user_limit", "packing_started", "tracking_duplicate",
  "wrong_item", "illegal_transition", "not_dead", "confirm_required"
]);

export function eventCatalog() { return { events: EVENT_CATALOG, error_code_families: ERROR_CODE_FAMILIES }; }
