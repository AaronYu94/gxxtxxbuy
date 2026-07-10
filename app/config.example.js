// Copy as config.js per environment. This file is public and must contain no secrets.
window.GOATEDBUY_CONFIG = Object.freeze({
  environment: "staging", // development | staging | production
  configVersion: "replace-with-release-id",
  apiBaseUrl: "https://staging-api.goatedbuy.example",
  defaultLocale: "en-US",
  // The final eight-language business list is pending approval. Enable only approved translations.
  enabledLocales: ["en-US"],
  frameworkLocales: ["en-US", "zh-CN", "zh-HK", "es-ES", "fr-FR", "de-DE", "ja-JP", "ko-KR"],
  defaultCurrency: "USD",
  displayCurrencies: ["USD", "CNY", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW"]
});
