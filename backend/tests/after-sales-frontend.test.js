import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);
function load() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("after-sales.js", APP_ROOT), "utf8"), context, { filename: "after-sales.js" });
  return window.GoatedBuyAfterSales;
}
const M = load();
const acts = (s, r) => Array.from(M.actionsFor(s, r)); // cross-realm array → local array

test("each state exposes only the acting role's legal actions", () => {
  assert.deepEqual(acts("purchase_reviewing", "procurement"), ["approve", "reject", "request_material"]);
  assert.deepEqual(acts("warehouse_picking_pending", "warehouse"), ["scan_pick"]);
  assert.deepEqual(acts("platform_refund_pending", "finance"), ["execute_refund"]);
  // Wrong role for the state → nothing.
  assert.equal(acts("platform_refund_pending", "warehouse").length, 0);
});

test("customer service is view-only in every state", () => {
  assert.equal(acts("purchase_reviewing", "support").length, 0);
  assert.equal(acts("platform_refund_pending", "support").length, 0);
  assert.equal(M.canCustomerServiceModify(), false);
});

test("terminal states offer no actions", () => {
  assert.equal(M.isTerminal("completed"), true);
  assert.equal(M.isTerminal("rejected"), true);
  assert.equal(M.isTerminal("closed"), true);
  assert.equal(M.isTerminal("purchase_reviewing"), false);
  assert.equal(acts("completed", "procurement").length, 0);
});

test("eligibility reasons map to messages", () => {
  assert.match(M.eligibilityMessage("window_expired"), /5-day/);
  assert.equal(M.eligibilityMessage(null), "");
});

test("users only see their own after-sales orders", () => {
  const orders = [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }];
  assert.equal(M.ownOnly(orders, "u1").length, 2);
});
