(function createCurrencyRuntime(global) {
  const ZERO_DECIMAL = new Set(["JPY", "KRW"]);
  function formatMinor(value, currency = "USD", locale = "en-US") {
    const code = String(currency).toUpperCase();
    const digits = ZERO_DECIMAL.has(code) ? 0 : 2;
    let minor;
    try { minor = BigInt(String(value)); } catch { throw new TypeError("Minor-unit amount must be an integer."); }
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const scale = 10n ** BigInt(digits);
    const whole = absolute / scale;
    const fraction = digits ? String(absolute % scale).padStart(digits, "0") : "";
    const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
    const parts = new Intl.NumberFormat(locale, {
      style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits
    }).formatToParts(0);
    let insertedInteger = false;
    const rendered = parts.map((part) => {
      if (part.type === "minusSign") return "";
      if (part.type === "integer") {
        if (insertedInteger) return "";
        insertedInteger = true;
        return grouped;
      }
      if (part.type === "group") return "";
      if (part.type === "fraction") return fraction;
      return part.value;
    }).join("");
    return negative ? `-${rendered}` : rendered;
  }
  global.GoatedBuyCurrency = Object.freeze({ formatMinor });
})(window);
