import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);
function load() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("warehouse.js", APP_ROOT), "utf8"), context, { filename: "warehouse.js" });
  return window.GoatedBuyWarehouse;
}
const M = load();

test("scan result messages distinguish matched / duplicate / unclaimed", () => {
  assert.equal(M.scanMessage({ matched: true }).text, "Matched to an order.");
  assert.equal(M.scanMessage({ existing: true }).dup, true);
  assert.equal(M.scanMessage({ matched: false }).unclaimed, true);
});

test("scan error codes map to clear operator messages", () => {
  assert.match(M.scanError("LOCATION_OCCUPIED"), /Move/);
  assert.match(M.scanError("photos_incomplete"), /four/);
  assert.match(M.scanError("not_eligible"), /150 days/);
});

test("users only see their own items; lists use thumbnails", () => {
  const items = [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }];
  assert.equal(M.ownOnly(items, "u1").length, 2);
  assert.equal(M.photoRef("qc/front.jpg", { thumbnail: true }), "qc/front_thumb.jpg");
  assert.equal(M.photoRef("qc/front.jpg"), "qc/front.jpg");
});
