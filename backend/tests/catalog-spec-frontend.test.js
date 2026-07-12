import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);

function loadCatalogSpec() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("catalog-spec.js", APP_ROOT), "utf8"), context, { filename: "catalog-spec.js" });
  return window.GoatedBuyCatalogSpec;
}

const snapshot = {
  price_cents: 19990,
  domestic_shipping_cents: 600,
  min_order_quantity: 1,
  skus: [
    { spec: "Black / 42", price_cents: 19990, available: true },
    { spec: "Black / 44", price_cents: 20990, available: false },
    { spec: "Bulk", price_cents: 1800, min_order_quantity: 2, available: true }
  ]
};

test("validateSelection enforces spec presence, availability, and platform minimum", () => {
  const spec = loadCatalogSpec();
  assert.equal(spec.validateSelection(snapshot, "", 1).reason, "spec_required");
  assert.equal(spec.validateSelection(snapshot, "Purple", 1).reason, "spec_invalid");
  assert.equal(spec.validateSelection(snapshot, "Black / 44", 1).reason, "spec_sold_out");
  assert.equal(spec.validateSelection(snapshot, "Bulk", 1).reason, "quantity_below_minimum");
  assert.equal(spec.validateSelection(snapshot, "Bulk", 2).valid, true);
  assert.equal(spec.validateSelection(snapshot, "Black / 42", 1).valid, true);
});

test("computeDisplayPrice uses integer cents and blocks purchase on unknown shipping", () => {
  const spec = loadCatalogSpec();
  const ok = spec.computeDisplayPrice(snapshot, "Black / 42", 2);
  assert.equal(ok.itemsCents, 39980);
  assert.equal(ok.totalCents, 40580);
  assert.equal(ok.purchasable, true);

  const noShip = spec.computeDisplayPrice({ ...snapshot, domestic_shipping_cents: null }, "Black / 42", 2);
  assert.equal(noShip.purchasable, false);
  assert.equal(noShip.reason, "domestic_shipping_unknown");
  assert.equal(noShip.totalCents, null); // never assume free

  const invalid = spec.computeDisplayPrice(snapshot, "Black / 44", 1);
  assert.equal(invalid.purchasable, false);
  assert.equal(invalid.reason, "spec_sold_out");
});

test("needsReconfirm flags a stale shown price", () => {
  const spec = loadCatalogSpec();
  assert.equal(spec.needsReconfirm(19990, snapshot, "Black / 42"), false);
  assert.equal(spec.needsReconfirm(18000, snapshot, "Black / 42"), true);
  assert.equal(spec.needsReconfirm(null, snapshot, "Black / 42"), false);
});
