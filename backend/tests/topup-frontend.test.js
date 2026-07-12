import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);

function loadModule() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("topup.js", APP_ROOT), "utf8"), context, { filename: "topup.js" });
  return window.GoatedBuyTopUp;
}

const M = loadModule();

test("only a server-confirmed top-up is treated as settled", () => {
  assert.equal(M.isSettled({ system_status: "succeeded" }), true);
  assert.equal(M.isSettled({ system_status: "pending_provider" }), false); // redirect return is not success
});

test("a still-pending top-up should be polled after the redirect return", () => {
  assert.equal(M.shouldPoll({ system_status: "pending_provider" }), true);
  assert.equal(M.shouldPoll({ system_status: "created" }), true);
  assert.equal(M.shouldPoll({ system_status: "succeeded" }), false);
});

test("terminal detection and credited-amount preview", () => {
  assert.equal(M.isTerminal({ system_status: "failed" }), true);
  assert.equal(M.isTerminal({ system_status: "pending_provider" }), false);
  assert.equal(M.creditedCny({ cny_credited_minor: 10000 }), 100);
  assert.equal(M.statusLabel("exception"), "Needs review");
});
