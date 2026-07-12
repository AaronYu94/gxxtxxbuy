import assert from "node:assert/strict";
import test from "node:test";
import { computeMetrics } from "../src/support/support-metrics.js";
import { createSupportService } from "../src/support/support-service.js";
import { MemorySupportRepository } from "./helpers/memory-support-repository.js";

const A1 = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const A2 = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const SUPPORT = ["support_agent"];

// ---- V2-10-16 pure metrics ----
test("metrics derive first-response + resolution from message roles and times", () => {
  const messages = [
    { direction: "inbound", eventAt: "2026-03-10T00:00:00Z" },
    { direction: "outbound", eventAt: "2026-03-10T00:10:00Z" },
    { direction: "inbound", eventAt: "2026-03-10T01:00:00Z" },
    { direction: "outbound", eventAt: "2026-03-10T01:05:00Z" }
  ];
  const m = computeMetrics(messages, { resolvedAt: "2026-03-10T02:00:00Z", reopenedCount: 1 });
  assert.equal(m.first_response_ms, 10 * 60 * 1000);
  assert.equal(m.avg_followup_ms, 5 * 60 * 1000);
  assert.equal(m.resolution_ms, 2 * 60 * 60 * 1000);
  assert.equal(m.reopened_count, 1);
  assert.equal(m.awaiting_reply, false);
});

function build({ userLookup = null } = {}) {
  const repository = new MemorySupportRepository();
  const svc = createSupportService({ repository, userLookup });
  return { repository, svc };
}

// ---- V2-10-13 inbound auto-link ----
test("inbound auto-links to a user by order number and is idempotent", async () => {
  const userLookup = {
    async findByOrderNo(no) { return no === "GO-PO-1" ? { id: "u1", email: "jane@x.com" } : null; },
    async findByParcelNo() { return null; },
    async findByEmail(e) { return e === "jane@x.com" ? { id: "u1", email: "jane@x.com" } : null; }
  };
  const { svc } = build({ userLookup });
  const first = await svc.ingestInbound({ external_id: "m1", from_email: "jane@x.com", order_no: "GO-PO-1", body: "help" });
  assert.equal(first.matched, true);
  assert.equal(first.related_type, "order");
  // Replayed inbound → deduped, no new conversation.
  const replay = await svc.ingestInbound({ external_id: "m1", from_email: "jane@x.com", order_no: "GO-PO-1", body: "help" });
  assert.equal(replay.deduped, true);
  assert.equal(replay.conversation_id, first.conversation_id);
});

test("inbound with no unique match is not guessed (left unlinked)", async () => {
  const userLookup = { async findByOrderNo() { return null; }, async findByParcelNo() { return null; }, async findByEmail() { return null; } };
  const { svc } = build({ userLookup });
  const res = await svc.ingestInbound({ external_id: "m2", from_email: "stranger@x.com", body: "hi" });
  assert.equal(res.matched, false);
  assert.equal(res.related_type, null);
});

// ---- V2-10-14 claim/reply/resolve/reopen ----
test("only one agent wins the claim; reply threads and marks first response", async () => {
  const { svc } = build();
  const conv = (await svc.createConversation(A1, SUPPORT, { subject: "x", requester_email: "a@x.com" })).conversation;
  const claimed = await svc.claim(A1, SUPPORT, conv.id);
  assert.equal(claimed.conversation.status, "claimed");
  await assert.rejects(() => svc.claim(A2, SUPPORT, conv.id), (e) => e.statusCode === 409);

  const replied = await svc.reply(A1, SUPPORT, conv.id, { body: "on it" });
  assert.equal(replied.messages.some((m) => m.direction === "outbound"), true);

  const resolved = await svc.resolve(A1, SUPPORT, conv.id);
  assert.equal(resolved.conversation.status, "resolved");
  const reopened = await svc.reopen(A1, SUPPORT, conv.id);
  assert.equal(reopened.conversation.status, "open");
  assert.equal(reopened.conversation.reopened_count, 1);
});

test("customer service is required; other roles cannot act", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createConversation(A1, ["campaign_operator"], {}), (e) => e.statusCode === 403);
});

// ---- V2-10-15 presale→aftersales link is read-only ----
test("support can link a conversation to after-sales but changes no after-sales state", async () => {
  const { repository, svc } = build();
  const conv = (await svc.createConversation(A1, SUPPORT, { subject: "return q" })).conversation;
  const res = await svc.linkAfterSales(A1, SUPPORT, conv.id, { after_sales_id: "as-1" });
  assert.equal(res.linked, true);
  // The link is recorded; there is NO API here that mutates after-sales — the
  // service exposes only a link, satisfying the read-only boundary.
  const detail = await svc.getConversation(conv.id);
  assert.deepEqual(detail.after_sales_links, ["as-1"]);
  assert.equal(typeof svc.transitionAfterSales, "undefined"); // no such capability
});
