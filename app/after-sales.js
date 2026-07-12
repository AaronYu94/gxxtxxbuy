// V2-08-14 — after-sales (returns & refunds) page logic (pure). Maps each state to
// the actions that are legal for the acting role, so every workbench (user,
// procurement, warehouse, finance) only ever shows valid actions. Customer service
// is view-only: it can read and communicate but never changes an after-sales state.
(function initAfterSales(global) {
  var STATUS_LABELS = {
    purchase_review_pending: "Awaiting review", purchase_reviewing: "Under review",
    customer_material_pending: "Awaiting your info", return_fee_due: "Return fee due",
    warehouse_picking_pending: "Awaiting pick", return_verifying: "Verifying", return_packing: "Packing",
    merchant_return_pending: "Ready to ship back", returned_to_merchant: "Returned to merchant",
    merchant_refund_pending: "Awaiting merchant refund", platform_refund_pending: "Awaiting refund",
    completed: "Completed", rejected: "Rejected", closed: "Closed", exception: "Exception"
  };
  function statusLabel(s) { return STATUS_LABELS[s] || String(s || ""); }

  // Actions per state, keyed by the acting role. Any role/state not listed → no
  // actions. Customer service ('support') is deliberately absent everywhere.
  var ACTIONS = {
    purchase_review_pending: { procurement: ["start_review"] },
    purchase_reviewing: { procurement: ["approve", "reject", "request_material"] },
    customer_material_pending: { user: ["supplement_material"], procurement: ["close"] },
    return_fee_due: { user: ["pay_return_fee"], procurement: ["close"] },
    warehouse_picking_pending: { warehouse: ["scan_pick"] },
    return_verifying: { warehouse: ["verify", "raise_exception"] },
    return_packing: { warehouse: ["pack", "raise_exception"] },
    merchant_return_pending: { warehouse: ["ship_back"] },
    returned_to_merchant: { procurement: ["merchant_received", "shipment_event"] },
    merchant_refund_pending: { procurement: ["register_merchant_refund"] },
    platform_refund_pending: { finance: ["execute_refund"] },
    exception: { warehouse: ["resolve_exception"], procurement: ["resolve_exception"] },
    completed: {}, rejected: {}, closed: {}
  };

  // Legal actions for a (status, role). Customer service always gets [].
  function actionsFor(status, role) {
    if (role === "support" || role === "customer_service") return [];
    var byRole = ACTIONS[status] || {};
    return (byRole[role] || []).slice();
  }

  // Customer service can never modify an after-sales order (frozen rule).
  function canCustomerServiceModify() { return false; }

  var terminal = { completed: true, rejected: true, closed: true };
  function isTerminal(status) { return terminal[status] === true; }

  var ELIGIBILITY = {
    not_warehoused: "Not warehoused yet.", after_sales_open: "A return is already open.",
    already_returning: "Already being returned.", not_available: "Not available to return.",
    no_deadline: "No return window.", window_expired: "The 5-day window has closed."
  };
  function eligibilityMessage(reason) { return reason ? (ELIGIBILITY[reason] || "Not eligible.") : ""; }

  // A user only ever sees their own after-sales orders.
  function ownOnly(orders, userId) {
    return (orders || []).filter(function (o) { return o && o.user_id === userId; });
  }

  global.GoatedBuyAfterSales = Object.freeze({
    statusLabel: statusLabel,
    actionsFor: actionsFor,
    canCustomerServiceModify: canCustomerServiceModify,
    isTerminal: isTerminal,
    eligibilityMessage: eligibilityMessage,
    ownOnly: ownOnly
  });
})(typeof window !== "undefined" ? window : this);
