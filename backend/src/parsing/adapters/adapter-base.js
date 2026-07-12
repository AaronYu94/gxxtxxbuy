// Shared adapter runner. Each platform adapter injects a `provider` — the
// licensed marketplace data client approved under GB-DEC-P0-004. Until that
// decision lands no provider is wired, so `fetchProduct` returns `not_configured`
// and the link falls back to manual completion. This keeps every platform behind
// one contract: routes and the parse queue only know `fetchProduct(ref) -> result`.
//
// Provider contract (what a real, licensed client must honor):
//   async provider.fetch(ref) -> rawProduct | null
//     - returns null            → listing does not exist / was removed
//     - throws { code: "TIMEOUT" | "RATE_LIMITED" | "LOGIN_WALL" | "ITEM_REMOVED" }
//       → mapped to the matching degraded status
//     - any other throw         → provider_error (retryable)

import { SNAPSHOT_STATUS, degraded } from "./product-snapshot.js";

const ERROR_CODE_TO_STATUS = {
  TIMEOUT: SNAPSHOT_STATUS.TIMEOUT,
  RATE_LIMITED: SNAPSHOT_STATUS.RATE_LIMITED,
  LOGIN_WALL: SNAPSHOT_STATUS.LOGIN_WALL,
  ITEM_REMOVED: SNAPSHOT_STATUS.ITEM_REMOVED
};

export function createAdapter({ platform, provider, mapProduct }) {
  return {
    platform,
    configured: Boolean(provider),

    async fetchProduct(ref) {
      if (!ref || !ref.itemId || ref.kind === "short" || ref.kind === "unknown") {
        return degraded(SNAPSHOT_STATUS.UNSUPPORTED, "ref cannot be resolved");
      }
      if (!provider) {
        return degraded(SNAPSHOT_STATUS.NOT_CONFIGURED, "no approved data source (GB-DEC-P0-004 pending)");
      }

      let raw;
      try {
        raw = await provider.fetch(ref);
      } catch (error) {
        const mapped = ERROR_CODE_TO_STATUS[error?.code];
        return degraded(mapped || SNAPSHOT_STATUS.PROVIDER_ERROR, error?.message || "provider failed");
      }

      if (!raw) {
        return degraded(SNAPSHOT_STATUS.ITEM_REMOVED, "listing not found");
      }
      // mapProduct returns either an ok(...) result or a degraded(...) result.
      return mapProduct(raw, ref);
    }
  };
}
