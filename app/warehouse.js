// V2-06-19 — warehouse + user storage page logic (pure). Turns scan results and
// error codes into clear operator messages, enforces that users only see their
// own packages/inventory, and uses thumbnails in lists (the original is fetched
// via a signed URL on demand, never a public path).
(function initWarehouse(global) {
  function scanMessage(result) {
    if (!result) return { ok: false, text: "Scan failed." };
    if (result.existing) return { ok: true, dup: true, text: "Already scanned — first scan is on record." };
    if (result.matched) return { ok: true, text: "Matched to an order." };
    return { ok: true, unclaimed: true, text: "No match — sent to the unclaimed queue." };
  }

  var ERRORS = {
    tracking_no: "Enter or scan a tracking number.",
    not_found: "Item not found.",
    LOCATION_OCCUPIED: "Item is already on a shelf — use Move instead.",
    LOCATION_MISMATCH: "Origin shelf does not match — rescan the current shelf.",
    photos_incomplete: "All four QC photos are required.",
    open_exception: "Resolve the QC exception first.",
    not_eligible: "Items cannot be destroyed before 150 days.",
    max_extension: "Storage can be extended at most two months."
  };

  function scanError(code) {
    return ERRORS[code] || "Action failed.";
  }

  // A user only ever sees their own packages/inventory.
  function ownOnly(items, userId) {
    return (items || []).filter(function (i) { return i && i.user_id === userId; });
  }

  // Lists render a thumbnail; the original is a separate signed fetch.
  function photoRef(key, opts) {
    opts = opts || {};
    if (!key) return "";
    return opts.thumbnail ? String(key).replace(/(\.[a-z0-9]+)$/i, "_thumb$1") : String(key);
  }

  global.GoatedBuyWarehouse = Object.freeze({
    scanMessage: scanMessage,
    scanError: scanError,
    ownOnly: ownOnly,
    photoRef: photoRef
  });
})(typeof window !== "undefined" ? window : this);
