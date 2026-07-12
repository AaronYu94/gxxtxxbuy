// V2-03-05 — Weidian (微店) adapter. The acceptance calls out four states that
// must be explicit rather than silently wrong: item does not exist, spec
// unavailable, image fetch failed, and price missing. Item-not-exist arrives as
// a null provider result (handled by the shared runner → item_removed); the rest
// are mapped here.
import { createAdapter } from "./adapter-base.js";
import { SNAPSHOT_STATUS, degraded, ok } from "./product-snapshot.js";
import { optionalYuanToCents } from "./money.js";

export function createWeidianAdapter({ provider = null } = {}) {
  return createAdapter({
    platform: "Weidian",
    provider,
    mapProduct(raw, ref) {
      const priceCents = optionalYuanToCents(raw.priceYuan);
      // Price missing → cannot be treated as free; force manual completion.
      if (!raw.title || priceCents === null) {
        return degraded(SNAPSHOT_STATUS.MISSING_FIELDS, "title or price missing");
      }

      // Image fetch failure: keep the resolved item but record no images. The
      // main-image state stays empty so the UI shows a placeholder rather than a
      // broken link.
      const images = raw.imageError ? [] : raw.images;

      // Spec unavailable → surface the spec with available:false rather than
      // dropping it, so the UI can show "sold out" instead of hiding the option.
      const skus = (raw.skus || []).map((sku) => ({
        spec: sku.spec,
        priceCents: optionalYuanToCents(sku.priceYuan) ?? priceCents,
        available: sku.available !== false
      }));

      return ok(
        {
          title: raw.title,
          shop: raw.shopName,
          images,
          mainImage: raw.imageError ? "" : raw.mainImage,
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
        "Weidian"
      );
    }
  });
}
