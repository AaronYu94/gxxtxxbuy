// V2-03-04 — 1688 adapter. 1688 differs from Taobao in four ways the acceptance
// calls out: tiered (阶梯) pricing, minimum order quantity (起订量), spec
// combinations (规格组合), and an explicit domestic-shipping field. The base
// price is taken from the lowest-MOQ tier so downstream price math is honest
// about the entry price; the full ladder is preserved on each sku.
import { createAdapter } from "./adapter-base.js";
import { SNAPSHOT_STATUS, degraded, ok } from "./product-snapshot.js";
import { optionalYuanToCents } from "./money.js";

export function createAlibaba1688Adapter({ provider = null } = {}) {
  return createAdapter({
    platform: "1688",
    provider,
    mapProduct(raw, ref) {
      const tiers = normalizeTiers(raw.priceTiers);
      const basePriceCents = tiers.length ? tiers[0].priceCents : optionalYuanToCents(raw.priceYuan);
      if (!raw.title || basePriceCents === null) {
        return degraded(SNAPSHOT_STATUS.MISSING_FIELDS, "title or tiered price missing");
      }

      const minOrderQuantity = Number.isInteger(raw.minOrderQuantity) && raw.minOrderQuantity > 0
        ? raw.minOrderQuantity
        : (tiers[0]?.minQuantity ?? null);

      // Spec combinations become skus; each carries its own price and MOQ so the
      // spec-selection UI can enforce per-combination limits.
      const skus = (raw.specCombinations || [])
        .map((combo) => ({
          spec: combo.spec,
          priceCents: optionalYuanToCents(combo.priceYuan) ?? basePriceCents,
          minOrderQuantity: Number.isInteger(combo.minOrderQuantity) ? combo.minOrderQuantity : minOrderQuantity,
          available: combo.available !== false
        }))
        .filter((sku) => sku.priceCents !== null && sku.priceCents > 0);

      return ok(
        {
          title: raw.title,
          shop: raw.shopName,
          images: raw.images,
          mainImage: raw.mainImage,
          priceCents: basePriceCents,
          currency: "CNY",
          domesticShippingCents: optionalYuanToCents(raw.domesticShippingYuan),
          spec: raw.spec,
          sizes: raw.sizes,
          colors: raw.colors,
          skus,
          minOrderQuantity,
          priceTiers: tiers,
          sourceUrl: raw.url || (ref && ref.url) || "",
          sourceCapturedAt: raw.capturedAt || null
        },
        "1688"
      );
    }
  });
}

function normalizeTiers(priceTiers) {
  if (!Array.isArray(priceTiers)) {
    return [];
  }
  return priceTiers
    .map((tier) => ({
      minQuantity: Number.isInteger(tier.minQuantity) && tier.minQuantity > 0 ? tier.minQuantity : 1,
      priceCents: optionalYuanToCents(tier.priceYuan)
    }))
    .filter((tier) => tier.priceCents !== null)
    .sort((a, b) => a.minQuantity - b.minQuantity);
}
