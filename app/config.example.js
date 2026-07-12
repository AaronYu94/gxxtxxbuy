// Public runtime configuration only — no secrets, ever. This file is the deploy default:
//   - GitHub Pages copies it to config.js at build time (.github/workflows/pages.yml).
//   - dev-router.mjs serves it as /config.js when a local app/config.js is absent
//     (Railway / VPS), so the client always has a config.
// apiBaseUrl auto-selects by hostname, so the same file is correct in production
// (*.goated-buy.us -> https://api.goated-buy.us) and locally (-> http://127.0.0.1:3000).
// For a fixed per-environment value, copy this to app/config.js and hardcode apiBaseUrl.
const onProdDomain = typeof location !== "undefined" && /(^|\.)goated-buy\.us$/i.test(location.hostname);
window.GOATEDBUY_CONFIG = Object.freeze({
  environment: onProdDomain ? "production" : "development",
  configVersion: "2026-07-12.v1",
  apiBaseUrl: onProdDomain ? "https://api.goated-buy.us" : "http://127.0.0.1:3000",
  defaultLocale: "en-US",
  // The final eight-language business list is pending approval. Enable only approved translations.
  enabledLocales: ["en-US"],
  frameworkLocales: ["en-US", "zh-CN", "zh-HK", "es-ES", "fr-FR", "de-DE", "ja-JP", "ko-KR"],
  defaultCurrency: "USD",
  displayCurrencies: ["USD", "CNY", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW"]
});
