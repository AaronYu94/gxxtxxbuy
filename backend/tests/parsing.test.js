import assert from "node:assert/strict";
import test from "node:test";
import { extractProductRef } from "../src/parsing/product-ref.js";
import { createPlaceholderProductSource } from "../src/parsing/product-source.js";
import { parseSavedLinkRecord } from "../src/parsing/parse-worker.js";
import { createCoreService } from "../src/core/core-service.js";
import { MemoryCoreRepository } from "./helpers/memory-core-repository.js";

test("extractProductRef pulls item ids per platform and flags short links", () => {
  assert.deepEqual(
    extractProductRef({ url: "https://item.taobao.com/item.htm?id=770241188", platform: "Taobao" }),
    { platform: "Taobao", itemId: "770241188", kind: "item" }
  );
  assert.deepEqual(
    extractProductRef({ url: "https://detail.1688.com/offer/653210987654.html", platform: "1688" }),
    { platform: "1688", itemId: "653210987654", kind: "item" }
  );
  assert.equal(extractProductRef({ url: "https://weidian.com/item.html?itemID=88123", platform: "Weidian" }).itemId, "88123");
  assert.equal(extractProductRef({ url: "https://x.yupoo.com/albums/abc123", platform: "Yupoo" }).kind, "album");
  // Short link cannot be resolved offline → flagged for a real resolver.
  assert.equal(extractProductRef({ url: "https://m.tb.cn/h.abcd", platform: "Taobao" }).kind, "short");
  // Missing id → unknown, not a bad guess.
  assert.equal(extractProductRef({ url: "https://item.taobao.com/item.htm", platform: "Taobao" }).itemId, null);
});

test("placeholder source returns deterministic structured data and null for unresolvable refs", async () => {
  const source = createPlaceholderProductSource();
  const a = await source.fetchProduct({ platform: "Taobao", itemId: "770241188", kind: "item" });
  const b = await source.fetchProduct({ platform: "Taobao", itemId: "770241188", kind: "item" });
  assert.equal(a.title, b.title); // deterministic
  assert.ok(a.priceCents > 0 && a.spec.includes("/"));
  // Yupoo album has images but no price → forces manual completion downstream.
  const album = await source.fetchProduct({ platform: "Yupoo", itemId: "abc123", kind: "album" });
  assert.equal(album.priceCents, null);
  assert.ok(album.images.length > 0);
  // Short/unknown refs return null.
  assert.equal(await source.fetchProduct({ platform: "Taobao", itemId: null, kind: "short" }), null);
});

test("parseSavedLinkRecord fills a link, degrades to needs_details, and fails safe", async () => {
  const repo = new MemoryCoreRepository();
  const userId = "u1";
  const source = createPlaceholderProductSource();

  const seed = async (url, platform) => {
    const link = await repo.createSavedLink({ userId, url, urlHash: url, domain: "d", platform, status: "parsing" });
    return link.id;
  };

  // Full resolve → parsed with title/spec/price.
  const okId = await seed("https://item.taobao.com/item.htm?id=770241188", "Taobao");
  const parsed = await parseSavedLinkRecord({ repository: repo, source }, { url: "https://item.taobao.com/item.htm?id=770241188", platform: "Taobao", userId, linkId: okId });
  assert.equal(parsed.status, "parsed");
  assert.ok(parsed.title && parsed.priceCents > 0);

  // Yupoo album → images but no price → needs_details, link preserved.
  const albumId = await seed("https://x.yupoo.com/albums/abc123", "Yupoo");
  const album = await parseSavedLinkRecord({ repository: repo, source }, { url: "https://x.yupoo.com/albums/abc123", platform: "Yupoo", userId, linkId: albumId });
  assert.equal(album.status, "needs_details");

  // Source throws → link marked failed with the error, never lost.
  const boomId = await seed("https://item.taobao.com/item.htm?id=1", "Taobao");
  const boomSource = { async fetchProduct() { throw new Error("blocked_by_risk_control"); } };
  const failed = await parseSavedLinkRecord({ repository: repo, source: boomSource, retries: 1 }, { url: "https://item.taobao.com/item.htm?id=1", platform: "Taobao", userId, linkId: boomId });
  assert.equal(failed.status, "failed");
  assert.equal(failed.parseError, "blocked_by_risk_control");
});

test("core service parseLink resolves inline when parseInline is on", async () => {
  const repo = new MemoryCoreRepository();
  const enqueued = [];
  const core = createCoreService({
    repository: repo,
    env: {},
    queue: { async enqueue(name, payload) { enqueued.push({ name, payload }); return { id: "job1" }; } },
    productSource: createPlaceholderProductSource(),
    parseInline: true
  });
  const user = { id: "u1" };
  const { link } = await core.saveLink(user, { url: "https://weidian.com/item.html?itemID=88123" });
  const result = await core.parseLink(user, link.id);
  assert.equal(enqueued.length, 1); // still enqueues for the async worker path
  assert.equal(result.link.status, "parsed");
  assert.ok(result.link.title);
});
