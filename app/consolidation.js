// V2-07-21 — consolidation (合包) page logic (pure). Turns parcel/bill/batch state
// into user- and warehouse-facing labels, decides which fee is payable next,
// enforces the pre-packing cancel window, computes picking progress, and maps
// backend error codes to clear messages. No DOM, no fetch — the page shell wires
// these to the API client.
(function initConsolidation(global) {
  // The frozen international-parcel flow, in order, for a progress rail.
  var FLOW = [
    "draft", "packing_fee_due", "warehouse_acceptance_pending", "picking", "packing",
    "shipping_fee_due", "outbound_pending", "outbound", "in_transit", "delivered", "completed"
  ];

  var STATUS_LABELS = {
    draft: "Draft", packing_fee_due: "Packing fee due", warehouse_acceptance_pending: "Awaiting warehouse",
    picking: "Picking", packing: "Packing", shipping_fee_due: "Shipping fee due",
    outbound_pending: "Ready to ship", outbound: "Outbound", in_transit: "In transit",
    delivered: "Delivered", completed: "Completed", cancelled: "Cancelled", exception: "Exception"
  };

  function statusLabel(status) { return STATUS_LABELS[status] || String(status || ""); }

  // 0-based position in the flow (−1 for cancelled/exception/unknown).
  function parcelStep(status) {
    var i = FLOW.indexOf(status);
    return i;
  }

  // A parcel can be cancelled only before the warehouse starts packing.
  function canCancel(status) {
    return status === "draft" || status === "packing_fee_due" || status === "warehouse_acceptance_pending";
  }

  // Which fee, if any, the user must pay next.
  function payableFee(parcel) {
    if (!parcel) return null;
    if (parcel.status === "packing_fee_due") return "packing";
    if (parcel.status === "shipping_fee_due") return "shipping";
    return null;
  }

  // Only warehoused, unreserved units are selectable for a new parcel.
  function selectableStock(units) {
    return (units || []).filter(function (u) { return u && u.status === "in_stock"; });
  }

  // Picking progress as a fraction + display text.
  function pickingProgress(p) {
    p = p || {};
    var total = Number(p.total) || 0;
    var picked = Number(p.picked) || 0;
    return { picked: picked, total: total, done: total > 0 && picked >= total, text: picked + " / " + total };
  }

  // Sum a bill's discounted total for display (already computed server-side).
  function billTotal(bill) { return bill ? Number(bill.total_cny_minor) || 0 : 0; }

  var ERRORS = {
    not_eligible: "This item isn't available to consolidate.",
    already_reserved: "This item is already in another parcel.",
    not_draft: "Only a draft parcel can be submitted.",
    packing_started: "Packing has started — the parcel can no longer be cancelled.",
    not_payable: "There's nothing to pay on this parcel.",
    foreign_item: "That item doesn't belong to this parcel.",
    not_picking: "This parcel isn't being picked.",
    picking_incomplete: "Scan every item before packing.",
    vas_incomplete: "Finish the photo value-added services first.",
    not_quotable: "This parcel can't ship on the selected route.",
    not_outbound_pending: "This parcel isn't ready for outbound.",
    in_batch: "This parcel is already in another batch.",
    batch_closed: "This batch is no longer accepting parcels.",
    bad_transition: "That tracking update isn't valid for this parcel.",
    not_configured: "This isn't available yet."
  };
  function errorMessage(code) { return ERRORS[code] || "Action failed."; }

  // Tracking-sync display for the user-facing timeline.
  var TRACKING_LABELS = { outbound: "Handed to carrier", in_transit: "In transit", delivered: "Delivered", completed: "Completed" };
  function trackingLabel(status) { return TRACKING_LABELS[status] || statusLabel(status); }

  // A user only ever sees their own parcels.
  function ownOnly(parcels, userId) {
    return (parcels || []).filter(function (p) { return p && p.user_id === userId; });
  }

  global.GoatedBuyConsolidation = Object.freeze({
    FLOW: FLOW,
    statusLabel: statusLabel,
    parcelStep: parcelStep,
    canCancel: canCancel,
    payableFee: payableFee,
    selectableStock: selectableStock,
    pickingProgress: pickingProgress,
    billTotal: billTotal,
    errorMessage: errorMessage,
    trackingLabel: trackingLabel,
    ownOnly: ownOnly
  });
})(typeof window !== "undefined" ? window : this);
