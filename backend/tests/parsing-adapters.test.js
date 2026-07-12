import assert from "node:assert/strict";
import test from "node:test";
import { createTaobaoAdapter } from "../src/parsing/adapters/taobao-adapter.js";
import { createAlibaba1688Adapter } from "../src/parsing/adapters/alibaba-1688-adapter.js";
import { createWeidianAdapter } from "../src/parsing/adapters/weidian-adapter.js";
import { createProductSourceRegistry, createNotConfiguredProductSource } from "../src/parsing/adapters/registry.js";
import { SNAPSHOT_STATUS, isRetryableStatus } from "../src/parsing/adapters/product-snapshot.js";

// A fake licensed provider — stands in for the real GB-DEC-P0-004 data source so
// the contract can be tested without simulating a live marketplace in production.
function fakeProvider(behavior) {
  return {
    async fetch(ref) {
      if (typeof behavior === "function") return behavior(ref);
      return behavior;
    }
  };
}

const taobaoRef = { platform: "Taobao", itemId: "770241188", kind: "item", url: "https://item.taobao.com/item.htm?id=770241188" };

test("every adapter degrades to not_configured with no provider and unsupported for bad refs", async () => {
  for (const adapter of [createTaobaoAdapter(), createAlibaba1688Adapter(), createWeidianAdapter()]) {
    assert.equal(adapter.configured, false);
    const notConfigured = await adapter.fetchProduct(taobaoRef);
    assert.equal(notConfigured.status, SNAPSHOT_STATUS.NOT_CONFIGURED);
    const unsupported = await adapter.fetchProduct({ platform: adapter.platform, itemId: null, kind: "short" });
    assert.equal(unsupported.status, SNAPSHOT_STATUS.UNSUPPORTED);
  }
});

test("Taobao adapter maps a raw item and enforces integer-cent money", async () => {
  const provider = fakeProvider({
    title: "Retro Low Sneaker", shopName: "GOAT Store", priceYuan: 199.9,
    images: ["a.jpg", "b.jpg"], spec: "Black / 42",
    skus: [{ spec: "Black / 42", priceYuan: 199.9, stock: 3 }, { spec: "Black / 44", priceYuan: 209, stock: 0 }]
  });
  const result = await createTaobaoAdapter({ provider }).fetchProduct(taobaoRef);
  assert.equal(result.status, SNAPSHOT_STATUS.OK);
  assert.equal(result.product.priceCents, 19990);
  assert.equal(result.product.currency, "CNY");
  assert.equal(result.product.mainImage, "a.jpg");
  assert.equal(result.product.skus[1].available, false); // stock 0 → unavailable
});

test("Taobao adapter maps provider failures onto the degradation taxonomy", async () => {
  const cases = [
    ["TIMEOUT", SNAPSHOT_STATUS.TIMEOUT],
    ["RATE_LIMITED", SNAPSHOT_STATUS.RATE_LIMITED],
    ["LOGIN_WALL", SNAPSHOT_STATUS.LOGIN_WALL],
    ["ITEM_REMOVED", SNAPSHOT_STATUS.ITEM_REMOVED]
  ];
  for (const [code, status] of cases) {
    const provider = fakeProvider(() => { throw Object.assign(new Error("x"), { code }); });
    const result = await createTaobaoAdapter({ provider }).fetchProduct(taobaoRef);
    assert.equal(result.status, status);
  }
  // Null result = listing gone.
  const gone = await createTaobaoAdapter({ provider: fakeProvider(null) }).fetchProduct(taobaoRef);
  assert.equal(gone.status, SNAPSHOT_STATUS.ITEM_REMOVED);
  // Missing required fields → manual completion, not a fabricated value.
  const missing = await createTaobaoAdapter({ provider: fakeProvider({ title: "", priceYuan: null }) }).fetchProduct(taobaoRef);
  assert.equal(missing.status, SNAPSHOT_STATUS.MISSING_FIELDS);

  assert.equal(isRetryableStatus(SNAPSHOT_STATUS.TIMEOUT), true);
  assert.equal(isRetryableStatus(SNAPSHOT_STATUS.LOGIN_WALL), false);
});

test("1688 adapter handles tiered price, MOQ, spec combos, and domestic shipping", async () => {
  const ref = { platform: "1688", itemId: "653210987654", kind: "item" };
  const provider = fakeProvider({
    title: "Cargo Trousers", shopName: "Factory 88",
    priceTiers: [{ minQuantity: 100, priceYuan: 12 }, { minQuantity: 2, priceYuan: 18 }, { minQuantity: 500, priceYuan: 9.5 }],
    minOrderQuantity: 2, domesticShippingYuan: 6,
    specCombinations: [
      { spec: "Olive / L", priceYuan: 18, minOrderQuantity: 2 },
      { spec: "Olive / XL", priceYuan: 19, available: false }
    ]
  });
  const result = await createAlibaba1688Adapter({ provider }).fetchProduct(ref);
  assert.equal(result.status, SNAPSHOT_STATUS.OK);
  // Base price is the lowest-MOQ tier (qty 2 → 18 yuan), not the cheapest bulk tier.
  assert.equal(result.product.priceCents, 1800);
  assert.equal(result.product.minOrderQuantity, 2);
  assert.equal(result.product.domesticShippingCents, 600);
  assert.equal(result.product.priceTiers.length, 3);
  assert.equal(result.product.priceTiers[0].minQuantity, 2); // sorted ascending
  assert.equal(result.product.skus.length, 2);
  assert.equal(result.product.skus[1].available, false);
});

test("Weidian adapter marks item-removed, spec-unavailable, image-fail, and price-missing explicitly", async () => {
  const ref = { platform: "Weidian", itemId: "88123", kind: "item" };
  const removed = await createWeidianAdapter({ provider: fakeProvider(null) }).fetchProduct(ref);
  assert.equal(removed.status, SNAPSHOT_STATUS.ITEM_REMOVED);

  const priceMissing = await createWeidianAdapter({ provider: fakeProvider({ title: "Tote", priceYuan: null }) }).fetchProduct(ref);
  assert.equal(priceMissing.status, SNAPSHOT_STATUS.MISSING_FIELDS);

  const imgFail = await createWeidianAdapter({
    provider: fakeProvider({ title: "Tote", priceYuan: 59, imageError: true, mainImage: "x.jpg", images: ["x.jpg"] })
  }).fetchProduct(ref);
  assert.equal(imgFail.status, SNAPSHOT_STATUS.OK);
  assert.deepEqual(imgFail.product.images, []);
  assert.equal(imgFail.product.mainImage, "");

  const specUnavail = await createWeidianAdapter({
    provider: fakeProvider({ title: "Tote", priceYuan: 59, skus: [{ spec: "Cream", available: false }] })
  }).fetchProduct(ref);
  assert.equal(specUnavail.product.skus[0].available, false);
});

test("registry dispatches by platform and defaults to not_configured", async () => {
  const registry = createNotConfiguredProductSource();
  assert.equal(registry.configured, false);
  assert.equal((await registry.fetchProduct(taobaoRef)).status, SNAPSHOT_STATUS.NOT_CONFIGURED);
  assert.equal((await registry.fetchProduct({ platform: "Yupoo", itemId: "a", kind: "album" })).status, SNAPSHOT_STATUS.UNSUPPORTED);

  const wired = createProductSourceRegistry({ providers: { Taobao: fakeProvider({ title: "X", priceYuan: 10 }) } });
  assert.equal(wired.configured, true);
  assert.equal((await wired.fetchProduct(taobaoRef)).status, SNAPSHOT_STATUS.OK);
});
