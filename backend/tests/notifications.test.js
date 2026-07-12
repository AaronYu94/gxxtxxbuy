import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { shouldDispatch, NOTIFICATION_CATALOG, CRON_CATALOG } from "../src/ops/notification-catalog.js";
import { createNotificationService } from "../src/ops/notification-service.js";
import { MemoryNotificationRepository } from "./helpers/memory-notification-repository.js";

// ---- V2-10-18 catalog + dispatch ----
test("the catalog covers all required notification types + cron jobs", () => {
  for (const t of ["topup_succeeded", "purchase_confirmed", "inbound_arrived", "qc_completed", "storage_reminder", "packing_done", "outbound_shipped", "refund_completed", "login_alert", "commission_earned"]) {
    assert.ok(NOTIFICATION_CATALOG[t], `missing ${t}`);
    assert.equal(NOTIFICATION_CATALOG[t].category, "transactional");
  }
  assert.ok(CRON_CATALOG.length >= 5);
  assert.equal(NOTIFICATION_CATALOG.promo_announcement.category, "marketing");
});

test("transactional always dispatches; marketing honours opt-out", () => {
  assert.equal(shouldDispatch("refund_completed", { marketingOptIn: false }).dispatch, true);
  assert.equal(shouldDispatch("promo_announcement", { marketingOptIn: false }).dispatch, false);
  assert.equal(shouldDispatch("promo_announcement", { marketingOptIn: true }).dispatch, true);
});

function build() { return createNotificationService({ repository: new MemoryNotificationRepository(), maxAttempts: 3 }); }

test("dispatch is idempotent per event key (a cron rerun never double-notifies)", async () => {
  const svc = build();
  const first = await svc.notify({ eventKey: "topup:tx-1", type: "topup_succeeded", userId: "u1" });
  const replay = await svc.notify({ eventKey: "topup:tx-1", type: "topup_succeeded", userId: "u1" });
  assert.equal(first.dispatched, true);
  assert.equal(replay.dispatched, false);
  assert.equal(replay.replay, true);
});

test("a marketing opt-out is suppressed (and logged idempotently)", async () => {
  const svc = build();
  const res = await svc.notify({ eventKey: "promo:1", type: "promo_announcement", userId: "u1", marketingOptIn: false });
  assert.equal(res.dispatched, false);
  assert.equal(res.suppressed, true);
});

test("exhausted retries dead-letter for alerting", async () => {
  const svc = build();
  await svc.notify({ eventKey: "qc:1", type: "qc_completed", userId: "u1" });
  await svc.recordFailure("qc:1"); // attempts 2
  await svc.recordFailure("qc:1"); // attempts 3 → dead
  const dead = (await svc.listDeadLetters()).dead_letters;
  assert.equal(dead.length, 1);
  assert.equal(dead[0].status, "dead");
});

// ---- V2-10-17/19 ops console frontend ----
test("ops console: page sizes, role dashboards, zero-safe display", () => {
  const window = {};
  const context = { window, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL("../../app/ops-console.js", import.meta.url), "utf8"), context, { filename: "ops-console.js" });
  const M = window.GoatedBuyOpsConsole;
  assert.equal(M.pageSize(50), 50);
  assert.equal(M.pageSize(37), 20);   // default when not allowed
  assert.equal(M.pageSize(undefined), 20);
  assert.ok(M.dashboardCards("finance_operator").includes("refunds"));
  assert.equal(M.isSearchOnlyHome("support_agent"), true);
  assert.equal(M.dashboardCards("support_agent").length, 0);
  assert.equal(M.statValue(0), "0"); // zero shows 0, never blank
  assert.equal(M.statValue(null), "0");
  // No cross-role aggregate: campaign can't see finance's refunds card.
  assert.equal(M.canSeeCard("campaign_operator", "refunds"), false);
  // Card link preserves filters.
  assert.match(M.cardLink("orders", { from: "2026-03-01", scope: "org" }), /from=2026-03-01.*scope=org/);
});
