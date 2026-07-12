// V2-11-13 — promotion & finance back-office logic (pure). Promotion ops see the
// relationship/level views but NOT sensitive amounts; finance only processes
// withdrawal payment; correcting a locked invitation relationship (super-admin)
// requires a second verification. Maps roles to capabilities and withdrawal
// actions.
(function initReferralAdmin(global) {
  // What each role may do in the promotion back-office.
  var CAPS = {
    referral_operator: ["view_relationships", "view_levels", "view_violations", "apply_discipline"],
    finance_operator: ["view_withdrawals", "pay_withdrawal", "review_withdrawal", "process_clawback"],
    super_admin: ["view_relationships", "view_levels", "view_violations", "apply_discipline", "view_withdrawals", "pay_withdrawal", "review_withdrawal", "process_clawback", "correct_relationship"]
  };

  function capabilities(role) { return (CAPS[role] || []).slice(); }
  function can(role, capability) { return capabilities(role).indexOf(capability) >= 0; }

  // Promotion operators never see sensitive commission amounts; finance/super do.
  function canSeeAmounts(role) { return role === "finance_operator" || role === "super_admin"; }

  // High-risk actions require a second verification (correcting a permanent
  // relationship, disqualifying a promoter).
  var DOUBLE_CONFIRM = { correct_relationship: true, disqualify: true };
  function requiresDoubleConfirm(action) { return DOUBLE_CONFIRM[action] === true; }

  // Withdrawal actions a finance role may take, by status.
  function withdrawalActions(status, role) {
    if (!can(role, "pay_withdrawal")) return [];
    if (status === "pending_review") return ["approve", "reject"];
    if (status === "processing") return ["pay", "fail"];
    return [];
  }

  // Mask a commission amount for a role that must not see it.
  function amountDisplay(role, amountMinor) { return canSeeAmounts(role) ? String(amountMinor) : "•••"; }

  global.GoatedBuyReferralAdmin = Object.freeze({
    capabilities: capabilities,
    can: can,
    canSeeAmounts: canSeeAmounts,
    requiresDoubleConfirm: requiresDoubleConfirm,
    withdrawalActions: withdrawalActions,
    amountDisplay: amountDisplay
  });
})(typeof window !== "undefined" ? window : this);
