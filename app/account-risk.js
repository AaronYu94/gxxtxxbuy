// V2-09-12 — account risk-control back-office logic (pure). Only finance and super
// admin may operate; every other role is read-blocked here. Maps lock-request and
// address-review states to the actions the acting role may take, and labels event
// severity + match verdicts. A blacklist match is always "review", never a ban.
(function initAccountRisk(global) {
  var OPERATOR_ROLES = { finance_operator: true, super_admin: true };

  function canOperate(role) { return OPERATOR_ROLES[role] === true; }

  // Actions on a lock request by role.
  function lockRequestActions(status, role) {
    if (status !== "pending_review") return [];
    if (role === "super_admin") return ["approve", "reject"];
    return []; // finance initiates but does not approve
  }

  function reviewFlagActions(status, role) {
    if (status !== "pending" || !canOperate(role)) return [];
    return ["clear", "confirm"];
  }

  var SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
  function severityLabel(s) { return SEVERITY_LABELS[s] || String(s || ""); }

  var VERDICT_LABELS = { exact: "Exact address match — review", fuzzy: "Near address match — review", none: "No match" };
  function verdictLabel(kind) { return VERDICT_LABELS[kind] || String(kind || ""); }

  // A blacklist match never bans automatically.
  function isAutoBan() { return false; }

  global.GoatedBuyAccountRisk = Object.freeze({
    canOperate: canOperate,
    lockRequestActions: lockRequestActions,
    reviewFlagActions: reviewFlagActions,
    severityLabel: severityLabel,
    verdictLabel: verdictLabel,
    isAutoBan: isAutoBan
  });
})(typeof window !== "undefined" ? window : this);
