// V2-03-03 — Taobao/Tmall adapter. Maps a licensed provider's raw item into the
// shared snapshot contract. Robustness (timeout, rate limit, delisting, login
// wall, missing fields) is handled by the shared runner and the missing-field
// guard here; nothing is fabricated.
import { createAdapter } from "./adapter-base.js";
import { SNAPSHOT_STATUS, degraded, ok } from "./product-snapshot.js";
import { yuanToCents, optionalYuanToCents } from "./money.js";

export function createTaobaoAdapter({ provider = null } = {}) {
  return createAdapter({
    platform: "Taobao",
    provider,
    mapProduct(raw, ref) {
      const priceCents = optionalYuanToCents(raw.priceYuan);
      if (!raw.title || priceCents === null) {
        return degraded(SNAPSHOT_STATUS.MISSING_FIELDS, "title or price missing");
      }
      const skus = (raw.skus || [])
        .filter((sku) => optionalYuanToCents(sku.priceYuan) !== null)
        .map((sku) => ({
          spec: sku.spec,
          priceCents: yuanToCents(sku.priceYuan),
          available: sku.stock === undefined ? true : sku.stock > 0
        }));
      return ok(
        {
          title: raw.title,
          shop: raw.shopName,
          images: raw.images,
          mainImage: raw.mainImage,
          priceCents,
          currency: "CNY",
          domesticShippingCents: optionalYuanToCents(raw.domesticShippingYuan),
          spec: raw.spec,
          sizes: raw.sizes,
          colors: raw.colors,
          skus,
          sourceUrl: raw.url || (ref && ref.url) || "",
          sourceCapturedAt: raw.capturedAt || null
        },
        "Taobao"
      );
    }
  });
}
