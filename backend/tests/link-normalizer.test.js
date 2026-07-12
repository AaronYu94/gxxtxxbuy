import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLink, identifyPlatform, MAX_URL_LENGTH } from "../src/parsing/link-normalizer.js";

test("normalizeLink identifies platforms and adds protocol", () => {
  assert.equal(normalizeLink("item.taobao.com/item.htm?id=1").platform, "Taobao");
  assert.equal(normalizeLink("https://detail.1688.com/offer/653.html").platform, "1688");
  assert.equal(normalizeLink("https://shop.weidian.com/item.html?itemID=9").platform, "Weidian");
  assert.equal(normalizeLink("https://x.yupoo.com/albums/a1").platform, "Yupoo");
  assert.equal(normalizeLink("https://example.com/p/1").platform, "Other");
  assert.equal(identifyPlatform("tmall.com"), "Taobao");
});

test("normalizeLink rejects empty, over-long, malformed, and illegal-protocol URLs", () => {
  assert.throws(() => normalizeLink(""), /required/);
  assert.throws(() => normalizeLink("x".repeat(MAX_URL_LENGTH + 1)), /2048 characters/);
  assert.throws(() => normalizeLink("https://nodots"), /valid http/);
  assert.throws(() => normalizeLink("javascript:alert(1)"), /http or https/);
  assert.throws(() => normalizeLink("ftp://item.taobao.com/x"), /http or https/);
  assert.throws(() => normalizeLink("file:///etc/passwd"), /http or https/);
});

test("normalizeLink flags short links without fabricating a target", () => {
  const short = normalizeLink("https://m.tb.cn/h.abcd");
  assert.equal(short.isShortLink, true);
  assert.equal(short.platform, "Taobao");
  assert.equal(normalizeLink("https://qr.1688.com/x").isShortLink, true);
  assert.equal(normalizeLink("https://item.taobao.com/item.htm?id=1").isShortLink, false);
});

test("normalizeLink strips tracking params and drops the fragment so cosmetic variants dedupe", () => {
  const clean = normalizeLink("https://item.taobao.com/item.htm?id=770241188");
  const noisy = normalizeLink(
    "https://item.taobao.com/item.htm?id=770241188&spm=a1z0d.7&utm_source=app&scm=abc#detail"
  );
  assert.deepEqual(noisy.strippedParams.sort(), ["scm", "spm", "utm_source"]);
  assert.equal(noisy.url, clean.url);
  assert.equal(noisy.dedupeHash, clean.dedupeHash);
  assert.ok(!noisy.url.includes("#"));
});

test("normalizeLink canonicalizes param order and host case for stable dedupe", () => {
  const a = normalizeLink("https://Item.Taobao.com/item.htm?b=2&a=1");
  const b = normalizeLink("https://item.taobao.com/item.htm?a=1&b=2");
  assert.equal(a.dedupeHash, b.dedupeHash);
  assert.equal(a.domain, "item.taobao.com");
});
