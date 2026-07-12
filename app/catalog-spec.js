// V2-03-09 — product specification-selection logic (spec, quantity, price, and
// China domestic shipping). Pure and framework-free so the client workbench can
// call it and it can be unit-tested in isolation. Mirrors the backend price rules
// exactly: integer minor units throughout, unknown domestic shipping is never
// treated as zero, invalid combinations are not purchasable, quantity respects
// the platform minimum, and a changed price forces an explicit re-confirm.
(function initCatalogSpec(global) {
  function availableSpecs(snapshot) {
    return (snapshot.skus || []).map((sku) => sku.spec).filter(Boolean);
  }

  function findSku(snapshot, spec) {
    if (!spec) return null;
    return (snapshot.skus || []).find((sku) => sku.spec === spec) || null;
  }

  function minQuantity(snapshot, sku) {
    return (sku && sku.min_order_quantity) || snapshot.min_order_quantity || 1;
  }

  function unitPriceCents(snapshot, sku) {
    return sku ? sku.price_cents : snapshot.price_cents;
  }

  // Validates a spec+quantity selection. Returns { valid, reason } — the reason
  // is a stable code the UI maps to a message.
  function validateSelection(snapshot, spec, quantity) {
    const specs = availableSpecs(snapshot);
    if (specs.length && !spec) {
      return { valid: false, reason: "spec_required" };
    }
    const sku = findSku(snapshot, spec);
    if (specs.length && !sku) {
      return { valid: false, reason: "spec_invalid" };
    }
    if (sku && sku.available === false) {
      return { valid: false, reason: "spec_sold_out" };
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { valid: false, reason: "quantity_invalid" };
    }
    const min = minQuantity(snapshot, sku);
    if (quantity < min) {
      return { valid: false, reason: "quantity_below_minimum", min };
    }
    return { valid: true, reason: "" };
  }

  // Computes the display price for the current selection. `purchasable` is false
  // whenever the selection is invalid OR domestic shipping is unknown — the UI
  // must not let the user buy in either case.
  function computeDisplayPrice(snapshot, spec, quantity) {
    const validation = validateSelection(snapshot, spec, quantity);
    const sku = findSku(snapshot, spec);
    const unit = unitPriceCents(snapshot, sku);
    if (!validation.valid) {
      return { purchasable: false, reason: validation.reason, unitPriceCents: unit, itemsCents: null, domesticShippingCents: snapshot.domestic_shipping_cents ?? null, totalCents: null };
    }
    const itemsCents = unit * quantity;
    const shipping = snapshot.domestic_shipping_cents;
    if (shipping === null || shipping === undefined) {
      // Unknown shipping: show items but block purchase; never assume free.
      return { purchasable: false, reason: "domestic_shipping_unknown", unitPriceCents: unit, itemsCents, domesticShippingCents: null, totalCents: null };
    }
    return { purchasable: true, reason: "", unitPriceCents: unit, itemsCents, domesticShippingCents: shipping, totalCents: itemsCents + shipping };
  }

  // A price shown to the user that no longer matches the snapshot must be
  // re-confirmed before checkout.
  function needsReconfirm(shownUnitPriceCents, snapshot, spec) {
    if (shownUnitPriceCents === null || shownUnitPriceCents === undefined) return false;
    return Number(shownUnitPriceCents) !== unitPriceCents(snapshot, findSku(snapshot, spec));
  }

  global.GoatedBuyCatalogSpec = Object.freeze({
    availableSpecs,
    findSku,
    minQuantity,
    unitPriceCents,
    validateSelection,
    computeDisplayPrice,
    needsReconfirm
  });
})(typeof window !== "undefined" ? window : this);
