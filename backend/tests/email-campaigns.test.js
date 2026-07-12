import assert from "node:assert/strict";
import test from "node:test";
import { createEmailCampaignService } from "../src/promo/email-campaign-service.js";
import { MemoryEmailCampaignRepository } from "./helpers/memory-email-campaign-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const OPS = ["campaign_operator"];

function build() {
  const repository = new MemoryEmailCampaignRepository();
  const svc = createEmailCampaignService({ repository });
  return { repository, svc };
}

async function scheduled(svc, repository, audience, over = {}) {
  const c = (await svc.createCampaign(ADMIN, OPS, { template_code: "promo", batch_size: 2, ...over })).campaign;
  await svc.scheduleCampaign(ADMIN, OPS, c.id, { audience });
  return c;
}

test("only campaign operators manage campaigns", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createCampaign(ADMIN, ["support_agent"], { template_code: "x" }), (e) => e.statusCode === 403);
});

test("scheduling freezes a deduped audience into batches and skips unsubscribed", async () => {
  const { repository, svc } = build();
  await svc.unsubscribe({ email: "gone@x.com" });
  const c = (await svc.createCampaign(ADMIN, OPS, { template_code: "promo", batch_size: 2 })).campaign;
  const res = await svc.scheduleCampaign(ADMIN, OPS, c.id, { audience: [
    { email: "a@x.com" }, { email: "A@x.com" }, { email: "b@x.com" }, { email: "gone@x.com" }
  ] });
  assert.equal(res.recipients, 3); // a, b, gone (A deduped)
  assert.equal(res.batches, 2);   // batch_size 2
  // The unsubscribed recipient is materialized but not queued.
  assert.equal(repository.recipients.find((r) => r.email === "gone@x.com").status, "unsubscribed");
  // Re-scheduling a non-draft campaign is refused.
  await assert.rejects(() => svc.scheduleCampaign(ADMIN, OPS, c.id, { audience: [{ email: "z@x.com" }] }), (e) => e.statusCode === 409);
});

test("sending a batch delivers queued recipients; a replayed send is a no-op", async () => {
  const { svc } = build();
  const c = await scheduled(svc, null, [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "unsub@x.com" }]);
  const batches = (await svc.listBatches(c.id)).batches;
  const first = await svc.sendBatch(ADMIN, OPS, batches[0].id);
  assert.equal(first.delivered, 2);
  // Replaying the same batch send delivers nothing.
  const replay = await svc.sendBatch(ADMIN, OPS, batches[0].id);
  assert.equal(replay.skipped, true);
});

test("pause only affects unsent batches; resume re-queues them", async () => {
  const { svc } = build();
  const c = await scheduled(svc, null, [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }, { email: "d@x.com" }]);
  const batches = (await svc.listBatches(c.id)).batches; // 2 batches of 2
  await svc.sendBatch(ADMIN, OPS, batches[0].id); // batch 1 sent
  const paused = await svc.pauseCampaign(ADMIN, OPS, c.id);
  assert.equal(paused.paused_batches, 1); // only batch 2 (pending) paused
  const after = (await svc.listBatches(c.id)).batches;
  assert.equal(after[0].status, "sent");   // untouched
  assert.equal(after[1].status, "paused");
  const resumed = await svc.resumeCampaign(ADMIN, OPS, c.id);
  assert.equal(resumed.resumed_batches, 1);
});

test("delivery events are idempotent and bot events don't move metrics", async () => {
  const { svc } = build();
  const c = await scheduled(svc, null, [{ email: "a@x.com" }]);
  const batches = (await svc.listBatches(c.id)).batches;
  await svc.sendBatch(ADMIN, OPS, batches[0].id);

  assert.equal((await svc.recordEvent({ external_id: "e1", campaign_id: c.id, email: "a@x.com", type: "open" })).recorded, true);
  // Replayed webhook → no-op.
  assert.equal((await svc.recordEvent({ external_id: "e1", campaign_id: c.id, email: "a@x.com", type: "open" })).recorded, false);
  // A bot click is recorded but doesn't count.
  await svc.recordEvent({ external_id: "e2", campaign_id: c.id, email: "a@x.com", type: "click", is_bot: true });
  const stats = (await svc.getStats(c.id)).stats;
  assert.equal(stats.sent, 1);
  assert.equal(stats.opened, 1);
  assert.equal(stats.clicked, 0); // bot click excluded
});

test("test-mode campaigns are flagged so dashboards can exclude their stats", async () => {
  const { svc } = build();
  const c = await scheduled(svc, null, [{ email: "a@x.com" }], { test_mode: true });
  const stats = await svc.getStats(c.id);
  assert.equal(stats.test_mode, true);
});
