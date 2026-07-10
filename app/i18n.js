(function createI18nRuntime(global) {
  const ENGLISH = Object.freeze({
    "nav.home": "Home", "nav.shipping": "Shipping Estimation", "nav.forwarding": "Forwarding",
    "nav.help": "Help Center", "nav.affiliate": "Affiliate", "account.title": "Account settings",
    "account.sign_in": "Sign in", "account.register": "Create account", "account.addresses": "Addresses",
    "account.profile": "Profile and preferences", "account.security": "Password and security",
    "account.delete": "Delete account", "common.save": "Save changes", "common.cancel": "Cancel",
    "common.loading": "Loading", "common.retry": "Try again", "common.empty": "Nothing here yet",
    "auth.email": "Email", "auth.password": "Password", "auth.verify_email": "Verify email",
    "auth.verify_device": "Verify this device", "auth.resend": "Send again", "auth.sign_out": "Sign out"
  });
  const RESOURCES = Object.freeze({
    "en-US": ENGLISH,
    "zh-CN": Object.freeze({ "locale.name": "简体中文" }),
    "zh-HK": Object.freeze({ "locale.name": "繁體中文" }),
    "es-ES": Object.freeze({ "locale.name": "Español" }),
    "fr-FR": Object.freeze({ "locale.name": "Français" }),
    "de-DE": Object.freeze({ "locale.name": "Deutsch" }),
    "ja-JP": Object.freeze({ "locale.name": "日本語" }),
    "ko-KR": Object.freeze({ "locale.name": "한국어" })
  });
  const warned = new Set();
  function create(locale = "en-US", logger = console) {
    let current = RESOURCES[locale] ? locale : "en-US";
    return Object.freeze({
      get locale() { return current; },
      setLocale(next) { current = RESOURCES[next] ? next : "en-US"; return current; },
      t(key) {
        const translated = RESOURCES[current]?.[key];
        if (translated !== undefined) return translated;
        const fallback = ENGLISH[key];
        if (current !== "en-US" && !warned.has(`${current}:${key}`)) {
          warned.add(`${current}:${key}`);
          logger.warn?.(`[i18n] Missing ${current}:${key}; using en-US.`);
        }
        return fallback ?? key;
      },
      resources: RESOURCES
    });
  }
  global.GoatedBuyI18n = Object.freeze({ create, resources: RESOURCES });
})(window);
