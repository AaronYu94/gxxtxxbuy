// V2-05-19 — wallet + finance display logic (pure). Includes the role-based
// redaction the finance back-office requires: customer service sees only the
// payment status (never amounts), finance never sees profit, and export is
// super-admin only.
(function initWallet(global) {
  function formatCny(minor) {
    if (typeof minor !== "number" || !isFinite(minor)) return "—";
    return (minor / 100).toFixed(2);
  }

  function totalBalance(wallet) {
    if (!wallet) return 0;
    return (wallet.available_cny_minor || 0) + (wallet.frozen_cny_minor || 0);
  }

  var TX_LABELS = {
    top_up: "Top-up",
    order_payment: "Order payment",
    surcharge_payment: "Surcharge",
    order_refund: "Refund",
    withdrawal_freeze: "Withdrawal hold",
    withdrawal_settle: "Withdrawal",
    withdrawal_unfreeze: "Hold released",
    adjust_credit: "Adjustment +",
    adjust_debit: "Adjustment -"
  };

  function txLabel(type) {
    return TX_LABELS[type] || type;
  }

  // Customer service sees only the payment status; finance never sees profit.
  function redactForRole(view, role) {
    if (!view) return view;
    if (role === "customer_service") {
      return { status: view.status };
    }
    if (role === "finance") {
      var copy = {};
      for (var k in view) {
        if (Object.prototype.hasOwnProperty.call(view, k) && k !== "profit") copy[k] = view[k];
      }
      return copy;
    }
    return view;
  }

  function canExport(role) {
    return role === "super_admin";
  }

  global.GoatedBuyWallet = Object.freeze({
    formatCny: formatCny,
    totalBalance: totalBalance,
    txLabel: txLabel,
    redactForRole: redactForRole,
    canExport: canExport
  });
})(typeof window !== "undefined" ? window : this);
