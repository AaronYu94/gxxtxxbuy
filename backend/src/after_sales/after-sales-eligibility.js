// V2-08-02 — 代购 5-day return eligibility, computed from the QC official-inbound
// time (inventory_units.return_deadline_at = official_inbound_at + 5 days).
//
// Rules (all must hold):
//  - the item is a 代购 item that has been officially warehoused (an inventory unit
//    exists and is in_stock — forwarded goods never have an item_order here);
//  - now is on or before the return deadline (the 5-day window);
//  - the unit is not already reserved into a parcel or a prior return;
//  - there is no open after-sales order for the item.
//
// Returns { eligible, reason, deadlineAt }. reason is a stable code when not.
export function evaluateReturnEligibility({ inventory, hasOpenAfterSales = false, nowMs }) {
  if (!inventory) {
    return { eligible: false, reason: "not_warehoused", deadlineAt: null };
  }
  const deadlineAt = inventory.returnDeadlineAt || null;
  if (hasOpenAfterSales) {
    return { eligible: false, reason: "after_sales_open", deadlineAt };
  }
  if (inventory.status === "returned" || inventory.status === "returning" || inventory.status === "return_reserved") {
    return { eligible: false, reason: "already_returning", deadlineAt };
  }
  if (inventory.status !== "in_stock") {
    // reserved into a parcel, outbound, destroyed, etc.
    return { eligible: false, reason: "not_available", deadlineAt };
  }
  const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : NaN;
  if (!Number.isFinite(deadlineMs)) {
    return { eligible: false, reason: "no_deadline", deadlineAt };
  }
  if (nowMs > deadlineMs) {
    return { eligible: false, reason: "window_expired", deadlineAt };
  }
  return { eligible: true, reason: null, deadlineAt };
}
