// Platform → adapter registry. This is the single seam the catalog parse queue
// talks to: `fetchProduct(ref)` dispatches to the right marketplace adapter by
// `ref.platform`. Providers are injected per platform; in production none are
// wired until GB-DEC-P0-004 approves a legal source, so every call degrades to
// `not_configured` and the link falls back to manual completion.
import { createTaobaoAdapter } from "./taobao-adapter.js";
import { createAlibaba1688Adapter } from "./alibaba-1688-adapter.js";
import { createWeidianAdapter } from "./weidian-adapter.js";
import { SNAPSHOT_STATUS, degraded } from "./product-snapshot.js";

export function createProductSourceRegistry({ providers = {} } = {}) {
  const adapters = {
    Taobao: createTaobaoAdapter({ provider: providers.Taobao || null }),
    1688: createAlibaba1688Adapter({ provider: providers["1688"] || null }),
    Weidian: createWeidianAdapter({ provider: providers.Weidian || null })
  };

  return {
    name: "registry",

    // True only when at least one platform has an approved provider wired.
    get configured() {
      return Object.values(adapters).some((adapter) => adapter.configured);
    },

    adapterFor(platform) {
      return adapters[platform] || null;
    },

    async fetchProduct(ref) {
      const adapter = adapters[ref?.platform];
      if (!adapter) {
        // Yupoo albums and unknown platforms have no scraping adapter in V2-03;
        // they always go to manual completion.
        return degraded(SNAPSHOT_STATUS.UNSUPPORTED, `no adapter for platform ${ref?.platform || "unknown"}`);
      }
      return adapter.fetchProduct(ref);
    }
  };
}

// Production default until a licensed provider is approved: everything degrades
// to not_configured. Never returns fabricated supplier data.
export function createNotConfiguredProductSource() {
  return createProductSourceRegistry({ providers: {} });
}
