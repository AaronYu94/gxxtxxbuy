// V2-05-08 — wallet top-up page logic (pure, framework-free). The redirect return
// is NEVER treated as success: only the server-confirmed system_status counts, so
// a returning user with a still-pending top-up is polled against the backend.
(function initTopUp(global) {
  var LABELS = {
    created: "Created",
    pending_provider: "Awaiting payment",
    succeeded: "Completed",
    failed: "Failed",
    expired: "Expired",
    exception: "Needs review"
  };

  function statusLabel(systemStatus) {
    return LABELS[systemStatus] || "Unknown";
  }

  // Success is server truth, not the payment redirect landing.
  function isSettled(top) {
    return Boolean(top) && top.system_status === "succeeded";
  }

  // After returning from the provider, a still-pending top-up must be polled
  // against the backend rather than shown as done.
  function shouldPoll(top) {
    return Boolean(top) && (top.system_status === "created" || top.system_status === "pending_provider");
  }

  function isTerminal(top) {
    return Boolean(top) && ["succeeded", "failed", "expired"].indexOf(top.system_status) !== -1;
  }

  // Credited amount preview in whole CNY (display only; backend is source of truth).
  function creditedCny(top) {
    if (!top || typeof top.cny_credited_minor !== "number") return null;
    return top.cny_credited_minor / 100;
  }

  global.GoatedBuyTopUp = Object.freeze({
    statusLabel: statusLabel,
    isSettled: isSettled,
    shouldPoll: shouldPoll,
    isTerminal: isTerminal,
    creditedCny: creditedCny
  });
})(typeof window !== "undefined" ? window : this);
