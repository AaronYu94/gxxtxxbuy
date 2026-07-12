import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);
function load() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("consolidation.js", APP_ROOT), "utf8"), context, { filename: "consolidation.js" });
  return window.GoatedBuyConsolidation;
}
const M = load();

test("the flow rail is the frozen international-parcel order", () => {
  assert.equal(M.FLOW[0], "draft");
  assert.equal(M.FLOW[M.FLOW.length - 1], "completed");
  assert.ok(M.parcelStep("packing") > M.parcelStep("picking"));
  assert.equal(M.parcelStep("cancelled"), -1);
});

test("cancel is offered only before packing starts", () => {
  assert.equal(M.canCancel("draft"), true);
  assert.equal(M.canCancel("warehouse_acceptance_pending"), true);
  assert.equal(M.canCancel("packing"), false);
  assert.equal(M.canCancel("outbound"), false);
});

test("payableFee picks the right bill for the current state", () => {
  assert.equal(M.payableFee({ status: "packing_fee_due" }), "packing");
  assert.equal(M.payableFee({ status: "shipping_fee_due" }), "shipping");
  assert.equal(M.payableFee({ status: "picking" }), null);
});

test("only warehoused, unreserved stock is selectable", () => {
  const units = [{ status: "in_stock" }, { status: "reserved" }, { status: "in_stock" }, { status: "picking" }];
  assert.equal(M.selectableStock(units).length, 2);
});

test("picking progress reports completion", () => {
  const p = M.pickingProgress({ picked: 1, total: 2 });
  assert.equal(p.picked, 1);
  assert.equal(p.total, 2);
  assert.equal(p.done, false);
  assert.equal(p.text, "1 / 2");
  assert.equal(M.pickingProgress({ picked: 2, total: 2 }).done, true);
});

test("error codes map to clear messages", () => {
  assert.match(M.errorMessage("packing_started"), /can no longer be cancelled/);
  assert.match(M.errorMessage("foreign_item"), /doesn't belong/);
  assert.match(M.errorMessage("in_batch"), /another batch/);
  assert.equal(M.errorMessage("unknown_code"), "Action failed.");
});

test("users only see their own parcels", () => {
  const parcels = [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }];
  assert.equal(M.ownOnly(parcels, "u1").length, 2);
});
