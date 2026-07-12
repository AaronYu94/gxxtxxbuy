// V2-04-06 — frozen sub-order status machines (V2-00-06). An item sub-order
// carries two independent fields so a price change or stockout never overwrites
// the real fulfillment position:
//   - fulfillment_status: where the item physically is in the pipeline.
//   - exception_status: an overlay that pauses the pipeline for a problem.
// Only the named transitions listed here are legal; anything else is a 409
// illegal-crossing.

export const FULFILLMENT_STATUSES = [
  "pending_payment", "agent_ordering", "purchasing", "seller_dispatch_pending",
  "seller_dispatched", "arrived", "qc_in_progress", "warehoused",
  "parcel_reserved", "return_in_progress", "destroy_pending", "outbound",
  "completed", "cancelled", "refunded", "destroyed"
];

export const EXCEPTION_STATUSES = [
  "none", "price_change_pending", "availability_pending",
  "customer_material_pending", "refund_pending", "manual_review", "resolved"
];

export const FULFILLMENT_TERMINAL = new Set(["completed", "cancelled", "refunded", "destroyed"]);

export const FULFILLMENT_TRANSITIONS = Object.freeze({
  pending_payment: ["agent_ordering", "cancelled"],
  agent_ordering: ["purchasing", "cancelled"],
  purchasing: ["seller_dispatch_pending", "cancelled"],
  seller_dispatch_pending: ["seller_dispatched", "cancelled"],
  seller_dispatched: ["arrived"],
  arrived: ["qc_in_progress"],
  qc_in_progress: ["warehoused"],
  warehoused: ["parcel_reserved", "return_in_progress", "destroy_pending"],
  parcel_reserved: ["warehoused", "outbound"],
  return_in_progress: ["refunded", "warehoused"],
  destroy_pending: ["destroyed"],
  outbound: ["completed"],
  completed: [],
  cancelled: [],
  refunded: [],
  destroyed: []
});

export const EXCEPTION_TRANSITIONS = Object.freeze({
  none: ["price_change_pending", "availability_pending", "customer_material_pending", "refund_pending", "manual_review"],
  price_change_pending: ["none", "refund_pending", "resolved"],
  availability_pending: ["none", "refund_pending", "resolved"],
  customer_material_pending: ["none", "refund_pending", "resolved", "manual_review"],
  refund_pending: ["resolved"],
  manual_review: ["none", "refund_pending", "resolved"],
  resolved: []
});

export function statusColumn(field) {
  return field === "exception" ? "exception_status" : "fulfillment_status";
}

export function isAllowedTransition(field, from, to) {
  const map = field === "exception" ? EXCEPTION_TRANSITIONS : FULFILLMENT_TRANSITIONS;
  if (!Object.prototype.hasOwnProperty.call(map, from)) {
    return false;
  }
  return map[from].includes(to);
}
