// V2-08-01 — the frozen after-sales state machine (V2-00-06). Every state has a
// unique code, a responsible role, and an explicit set of legal exits. Any
// transition not listed here is rejected; the history table records each move.

export const AFTER_SALES_STATUSES = [
  "purchase_review_pending", "purchase_reviewing", "customer_material_pending", "return_fee_due",
  "warehouse_picking_pending", "return_verifying", "return_packing", "merchant_return_pending",
  "returned_to_merchant", "merchant_refund_pending", "platform_refund_pending",
  "completed", "rejected", "closed", "exception"
];

// Legal next-states, keyed by current state.
export const AFTER_SALES_TRANSITIONS = Object.freeze({
  purchase_review_pending: ["purchase_reviewing"],
  purchase_reviewing: ["customer_material_pending", "rejected", "return_fee_due", "warehouse_picking_pending"],
  customer_material_pending: ["purchase_reviewing", "closed"],
  return_fee_due: ["warehouse_picking_pending", "closed"],
  warehouse_picking_pending: ["return_verifying"],
  return_verifying: ["return_packing", "exception"],
  return_packing: ["merchant_return_pending", "exception"],
  merchant_return_pending: ["returned_to_merchant"],
  returned_to_merchant: ["merchant_refund_pending", "exception"],
  merchant_refund_pending: ["platform_refund_pending", "exception"],
  platform_refund_pending: ["completed", "exception"],
  completed: [],
  rejected: [],
  closed: [],
  // Exception returns to a specific legal node or closes (owner decides).
  exception: [
    "return_verifying", "return_packing", "merchant_return_pending", "returned_to_merchant",
    "merchant_refund_pending", "platform_refund_pending", "closed"
  ]
});

export const AFTER_SALES_TERMINAL = new Set(["completed", "rejected", "closed"]);

// The responsible role for each state (for the current_owner_role column + UI).
export const AFTER_SALES_ROLE = Object.freeze({
  purchase_review_pending: "procurement",
  purchase_reviewing: "procurement",
  customer_material_pending: "user",
  return_fee_due: "user",
  warehouse_picking_pending: "warehouse",
  return_verifying: "warehouse",
  return_packing: "warehouse",
  merchant_return_pending: "warehouse",
  returned_to_merchant: "procurement",
  merchant_refund_pending: "procurement",
  platform_refund_pending: "finance",
  completed: "system",
  rejected: "procurement",
  closed: "system",
  exception: "warehouse"
});

export function isAllowedAfterSalesTransition(from, to) {
  const allowed = AFTER_SALES_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}
