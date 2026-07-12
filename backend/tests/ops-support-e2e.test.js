import assert from "node:assert/strict";
import test from "node:test";
import { createCouponService } from "../src/promo/coupon-service.js";
import { MemoryCouponRepository } from "./helpers/memory-coupon-repository.js";
import { createEmailCampaignService } from "../src/promo/email-campaign-service.js";
import { MemoryEmailCampaignRepository } from "./helpers/memory-email-campaign-repository.js";
import { createSupportService } from "../src/support/support-service.js";
import { MemorySupportRepository } from "./helpers/memory-support-repository.js";
import { createCmsService } from "../src/cms/cms-service.js";
import { MemoryCmsRepository } from "./helpers/memory-cms-repository.js";
import { createNotificationService } from "../src/ops/notification-service.js";
import { MemoryNotificationRepository } from "./helpers/memory-notification-repository.js";

// V2-10-20 — operations & support integration: coupon concurrency, email dedup,
// inbound forgery boundary, support over-reach, template variables, cron rerun.
const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const CAMPAIGN = ["campaign_operator"];
const SUPPORT = ["support_agent"];
const U1 = { id: "11111111-1111-1111-1111-111111111111" };
const U2 = { id: "22222222-2222-2222-2222-222222222222" };

test("V2-10-20 ①: only one coupon settles per parcel (concurrent reserve)", async () => {
  const repo = new MemoryCouponRepository();
  const svc = createCouponService({ repository: repo });
  const c = (await svc.createCoupon(ADMIN, CAMPAIGN, { code: "SHIP", discount_type: "fixed", fixed_value_minor: 500, total_quota: 5, per_user_limit: 1 })).coupon;
  await svc.publishCoupon(ADMIN, CAMPAIGN, c.id);
  await svc.redeemCode(U1, { coupon_code: "SHIP" });
  await svc.redeemCode(U2, { coupon_code: "SHIP" });
  await svc.reserveForParcel(U1.id, { couponCode: "SHIP", parcelId: "p1", shippingMinor: 8000 });
  // A second coupon cannot also take the same parcel.
  await assert.rejects(() => svc.reserveForParcel(U2.id, { couponCode: "SHIP", parcelId: "p1", shippingMinor: 8000 }), (e) => e.statusCode === 409);
});

test("V2-10-20 ②: a replayed email delivery event does not double-count", async () => {
  const svc = createEmailCampaignService({ repository: new MemoryEmailCampaignRepository() });
  const camp = (await svc.createCampaign(ADMIN, CAMPAIGN, { template_code: "promo", batch_size: 10 })).campaign;
  await svc.scheduleCampaign(ADMIN, CAMPAIGN, camp.id, { audience: [{ email: "a@x.com" }] });
  const batches = (await svc.listBatches(camp.id)).batches;
  await svc.sendBatch(ADMIN, CAMPAIGN, batches[0].id);
  await svc.recordEvent({ external_id: "e1", campaign_id: camp.id, email: "a@x.com", type: "open" });
  await svc.recordEvent({ external_id: "e1", campaign_id: camp.id, email: "a@x.com", type: "open" }); // replay
  assert.equal((await svc.getStats(camp.id)).stats.opened, 1);
});

test("V2-10-20 ③: a forged inbound with no unique match is not attributed to a user", async () => {
  const userLookup = { async findByOrderNo() { return null; }, async findByParcelNo() { return null; }, async findByEmail() { return null; } };
  const svc = createSupportService({ repository: new MemorySupportRepository(), userLookup });
  const res = await svc.ingestInbound({ external_id: "forged-1", from_email: "attacker@x.com", order_no: "GO-PO-NOPE", body: "give me a refund" });
  assert.equal(res.matched, false); // never guesses an owner
});

test("V2-10-20 ④: non-support roles cannot act on conversations; CS cannot change after-sales", async () => {
  const svc = createSupportService({ repository: new MemorySupportRepository() });
  await assert.rejects(() => svc.createConversation(ADMIN, ["finance_operator"], {}), (e) => e.statusCode === 403);
  const conv = (await svc.createConversation(ADMIN, SUPPORT, { subject: "x" })).conversation;
  await svc.linkAfterSales(ADMIN, SUPPORT, conv.id, { after_sales_id: "as-1" });
  // The support service exposes only a link — no method mutates after-sales state.
  assert.equal(typeof svc.approveAfterSales, "undefined");
  assert.equal(typeof svc.transitionAfterSales, "undefined");
});

test("V2-10-20 ⑤: a template with an undeclared variable cannot publish", async () => {
  const svc = createCmsService({ repository: new MemoryCmsRepository() });
  const t = (await svc.createTemplate(ADMIN, CAMPAIGN, { code: "welcome", language: "en", subject: "Hi {{name}}", body: "{{secret}}", variables: ["name"] })).template;
  await assert.rejects(() => svc.publishTemplate(ADMIN, CAMPAIGN, t.id), (e) => e.statusCode === 400);
});

test("V2-10-20 ⑥: a cron rerun (same event key) never double-notifies", async () => {
  const svc = createNotificationService({ repository: new MemoryNotificationRepository() });
  const first = await svc.notify({ eventKey: "storage_reminder:unit-1:day-3", type: "storage_reminder", userId: U1.id });
  const rerun = await svc.notify({ eventKey: "storage_reminder:unit-1:day-3", type: "storage_reminder", userId: U1.id });
  assert.equal(first.dispatched, true);
  assert.equal(rerun.dispatched, false);
});
