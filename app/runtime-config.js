(function loadRuntimeConfig(global) {
  const raw = global.GOATEDBUY_CONFIG;
  const diagnostics = [];
  if (!raw || typeof raw !== "object") diagnostics.push("GOATEDBUY_CONFIG is missing.");
  const config = raw || {};
  let apiBaseUrl = "";
  try {
    const parsed = new URL(String(config.apiBaseUrl || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    apiBaseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    diagnostics.push("apiBaseUrl must be an absolute HTTP(S) URL.");
  }
  const frameworkLocales = arrayOfStrings(config.frameworkLocales);
  const enabledLocales = arrayOfStrings(config.enabledLocales);
  const displayCurrencies = arrayOfStrings(config.displayCurrencies).map((code) => code.toUpperCase());
  if (frameworkLocales.length !== 8) diagnostics.push("frameworkLocales must contain exactly eight locale slots.");
  if (!enabledLocales.length) diagnostics.push("At least one enabledLocale is required.");
  if (!enabledLocales.every((locale) => frameworkLocales.includes(locale))) diagnostics.push("enabledLocales must be included in frameworkLocales.");
  if (!/^[A-Z]{3}$/.test(String(config.defaultCurrency || ""))) diagnostics.push("defaultCurrency must be an ISO 4217 code.");
  if (!displayCurrencies.includes(String(config.defaultCurrency || "").toUpperCase())) diagnostics.push("defaultCurrency must be enabled in displayCurrencies.");
  const safeConfig = Object.freeze({
    environment: String(config.environment || "development"),
    configVersion: String(config.configVersion || "unversioned"),
    apiBaseUrl,
    defaultLocale: String(config.defaultLocale || "en-US"),
    enabledLocales: Object.freeze(enabledLocales),
    frameworkLocales: Object.freeze(frameworkLocales),
    defaultCurrency: String(config.defaultCurrency || "USD").toUpperCase(),
    displayCurrencies: Object.freeze(displayCurrencies)
  });
  global.GoatedBuyRuntime = Object.freeze({ config: safeConfig, diagnostics: Object.freeze(diagnostics), valid: diagnostics.length === 0 });
})(window);

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}
