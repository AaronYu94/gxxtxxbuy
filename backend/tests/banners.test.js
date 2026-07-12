import assert from "node:assert/strict";
import test from "node:test";
import { isComplete, isSafeLink, imageForDevice, isLive } from "../src/promo/banner-rules.js";
import { createBannerService } from "../src/promo/banner-service.js";
import { MemoryBannerRepository } from "./helpers/memory-banner-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const OPS = ["campaign_operator"];
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

// ---- V2-10-05 pure rules ----
test("safe-link validation blocks unsafe schemes", () => {
  assert.equal(isSafeLink("/promo"), true);
  assert.equal(isSafeLink("https://x.com/a"), true);
  assert.equal(isSafeLink(""), true);
  assert.equal(isSafeLink("javascript:alert(1)"), false);
  assert.equal(isSafeLink("http://x.com"), false);
  assert.equal(isSafeLink("//evil.com"), false);
});

test("device image falls back to desktop; completeness needs all three", () => {
  const b = { desktopImageKey: "d", tabletImageKey: "t", mobileImageKey: "m" };
  assert.equal(imageForDevice(b, "mobile"), "m");
  assert.equal(imageForDevice({ desktopImageKey: "d" }, "mobile"), "d");
  assert.equal(isComplete(b), true);
  assert.equal(isComplete({ desktopImageKey: "d" }), false);
});

test("liveness respects the schedule window", () => {
  const b = { status: "published", startsAt: "2026-03-05", endsAt: "2026-03-20" };
  assert.equal(isLive(b, NOW), true);
  assert.equal(isLive({ ...b, endsAt: "2026-03-08" }, NOW), false);
  assert.equal(isLive({ ...b, status: "unpublished" }, NOW), false);
});

function build() {
  const repository = new MemoryBannerRepository();
  const svc = createBannerService({ repository, clock: () => NOW });
  return { repository, svc };
}

async function fullBanner(svc, over = {}) {
  return (await svc.createBanner(ADMIN, OPS, {
    title: "Spring", language: "en", country_code: "US",
    desktop_image_key: "d.jpg", tablet_image_key: "t.jpg", mobile_image_key: "m.jpg",
    link_url: "/spring", sort_order: 1, ...over
  })).banner;
}

// ---- V2-10-06 publish gates + client read ----
test("a banner without all images cannot be published; a safe complete one can", async () => {
  const { svc } = build();
  const partial = (await svc.createBanner(ADMIN, OPS, { title: "x", desktop_image_key: "d.jpg" })).banner;
  await assert.rejects(() => svc.publishBanner(ADMIN, OPS, partial.id), (e) => e.statusCode === 409);
  const full = await fullBanner(svc);
  const pub = await svc.publishBanner(ADMIN, OPS, full.id);
  assert.equal(pub.banner.status, "published");
});

test("an unsafe redirect link is rejected at create", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createBanner(ADMIN, OPS, { title: "x", link_url: "javascript:void(0)" }), (e) => e.statusCode === 400);
});

test("client read returns only live banners resolved to the device image", async () => {
  const { svc } = build();
  const b = await fullBanner(svc, { starts_at: "2026-03-01", ends_at: "2026-03-31" });
  await svc.publishBanner(ADMIN, OPS, b.id);
  // Also an expired one that must not show.
  const expired = await fullBanner(svc, { title: "old", starts_at: "2026-01-01", ends_at: "2026-02-01" });
  await svc.publishBanner(ADMIN, OPS, expired.id);

  const list = (await svc.listForClient({ language: "en", country: "US", device: "mobile" })).banners;
  assert.equal(list.length, 1);
  assert.equal(list[0].image_key, "m.jpg"); // device-resolved
  assert.equal(list[0].title, "Spring");
});

test("unpublishing removes a banner from the client read (no stale display)", async () => {
  const { svc } = build();
  const b = await fullBanner(svc);
  await svc.publishBanner(ADMIN, OPS, b.id);
  assert.equal((await svc.listForClient({ language: "en", country: "US" })).banners.length, 1);
  await svc.unpublishBanner(ADMIN, OPS, b.id);
  assert.equal((await svc.listForClient({ language: "en", country: "US" })).banners.length, 0);
});

test("only campaign operators manage banners", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createBanner(ADMIN, ["support_agent"], { title: "x" }), (e) => e.statusCode === 403);
});
