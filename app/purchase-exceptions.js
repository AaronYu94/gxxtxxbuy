// V2-04-12 — purchase-exception page logic (pure, framework-free so the client
// workbench can call it and it can be unit-tested in isolation). Enforces the
// deadline, keeps the choices mutually exclusive, and guards against double
// submits so repeated clicks never fire a second surcharge, replacement, or
// cancel.
(function initPurchaseExceptions(global) {
  function choices(type) {
    return type === "price_increase"
      ? ["pay_surcharge", "cancel"]
      : ["wait", "change_spec", "change_link", "cancel"];
  }

  function isExpired(exception, nowMs) {
    if (!exception || !exception.deadline_at) return false;
    return Number(nowMs) > Date.parse(exception.deadline_at);
  }

  function canRespond(exception, nowMs) {
    return Boolean(exception) && exception.status === "open" && !isExpired(exception, nowMs);
  }

  function validateResponse(exception, choice, payload, nowMs) {
    if (!canRespond(exception, nowMs)) return { ok: false, reason: "expired_or_closed" };
    if (choices(exception.type).indexOf(choice) === -1) return { ok: false, reason: "invalid_choice" };
    if (choice === "change_spec" && !String((payload || {}).spec || "").trim()) return { ok: false, reason: "spec_required" };
    if (choice === "change_link" && !String((payload || {}).link || "").trim()) return { ok: false, reason: "link_required" };
    return { ok: true };
  }

  // A one-in-flight-per-key guard: begin() returns false while a submit for the
  // same key is still pending, so a double click cannot fire a second request.
  function createSubmitGuard() {
    var inflight = {};
    return {
      begin: function begin(key) {
        if (inflight[key]) return false;
        inflight[key] = true;
        return true;
      },
      end: function end(key) {
        delete inflight[key];
      }
    };
  }

  global.GoatedBuyPurchaseExceptions = Object.freeze({
    choices,
    isExpired,
    canRespond,
    validateResponse,
    createSubmitGuard
  });
})(typeof window !== "undefined" ? window : this);
