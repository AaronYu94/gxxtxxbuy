import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);

function load() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("wallet.js", APP_ROOT), "utf8"), context, { filename: "wallet.js" });
  return window.GoatedBuyWallet;
}

const M = load();

test("money formatting and total balance", () => {
  assert.equal(M.formatCny(10000), "100.00");
  assert.equal(M.formatCny(null), "—");
  assert.equal(M.totalBalance({ available_cny_minor: 6000, frozen_cny_minor: 4000 }), 10000);
  assert.equal(M.txLabel("order_payment"), "Order payment");
});

test("role redaction: CS sees only status, finance never sees profit, export is super-admin only", () => {
  const view = { status: "paid", amount_cny_minor: 5000, profit: 800 };
  assert.deepEqual(Object.keys(M.redactForRole(view, "customer_service")), ["status"]);
  const financeView = M.redactForRole(view, "finance");
  assert.equal(financeView.profit, undefined);
  assert.equal(financeView.amount_cny_minor, 5000);
  assert.equal(M.canExport("super_admin"), true);
  assert.equal(M.canExport("finance"), false);
});
