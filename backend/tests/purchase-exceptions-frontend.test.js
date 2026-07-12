import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);

function loadModule() {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("purchase-exceptions.js", APP_ROOT), "utf8"), context, { filename: "purchase-exceptions.js" });
  return window.GoatedBuyPurchaseExceptions;
}

const M = loadModule();
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const NOW = Date.parse("2026-07-10T00:00:00.000Z");

test("choices are type-specific and mutually exclusive", () => {
  assert.deepEqual(Array.from(M.choices("price_increase")), ["pay_surcharge", "cancel"]);
  assert.deepEqual(Array.from(M.choices("availability")), ["wait", "change_spec", "change_link", "cancel"]);
});

test("an open, pre-deadline exception can be responded to; expired or closed cannot", () => {
  assert.equal(M.canRespond({ status: "open", deadline_at: FUTURE }, NOW), true);
  assert.equal(M.canRespond({ status: "open", deadline_at: PAST }, NOW), false); // expired
  assert.equal(M.canRespond({ status: "resolved", deadline_at: FUTURE }, NOW), false); // closed
});

test("validateResponse enforces deadline, valid choice, and required fields", () => {
  const priceEx = { type: "price_increase", status: "open", deadline_at: FUTURE };
  assert.equal(M.validateResponse(priceEx, "pay_surcharge", {}, NOW).ok, true);
  assert.equal(M.validateResponse(priceEx, "wait", {}, NOW).reason, "invalid_choice");

  const availEx = { type: "availability", status: "open", deadline_at: FUTURE };
  assert.equal(M.validateResponse(availEx, "change_spec", { spec: "" }, NOW).reason, "spec_required");
  assert.equal(M.validateResponse(availEx, "change_spec", { spec: "Black / 42" }, NOW).ok, true);
  assert.equal(M.validateResponse(availEx, "change_link", { link: "" }, NOW).reason, "link_required");

  const expired = { type: "availability", status: "open", deadline_at: PAST };
  assert.equal(M.validateResponse(expired, "wait", {}, NOW).reason, "expired_or_closed");
});

test("submit guard blocks a second click while the first is in flight", () => {
  const guard = M.createSubmitGuard();
  assert.equal(guard.begin("item-1"), true);
  assert.equal(guard.begin("item-1"), false); // double click blocked
  guard.end("item-1");
  assert.equal(guard.begin("item-1"), true); // allowed again after completion
});
