import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const APP_ROOT = new URL("../../app/", import.meta.url);

function runBrowserScript(file, window = {}) {
  const context = { window, URL, console };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync(new URL(file, APP_ROOT), "utf8"), context, { filename: file });
  return context.window;
}

test("frontend runtime config validates public eight-slot framework without secrets", () => {
  const window = runBrowserScript("config.js", {});
  runBrowserScript("runtime-config.js", window);
  assert.equal(window.GoatedBuyRuntime.valid, true);
  assert.equal(window.GoatedBuyRuntime.config.frameworkLocales.length, 8);
  assert.deepEqual([...window.GoatedBuyRuntime.config.enabledLocales], ["en-US"]);
  assert.doesNotMatch(JSON.stringify(window.GOATEDBUY_CONFIG), /password|secret|token/i);

  const invalid = runBrowserScript("runtime-config.js", { GOATEDBUY_CONFIG: { apiBaseUrl: "javascript:bad" } });
  assert.equal(invalid.GoatedBuyRuntime.valid, false);
  assert.ok(invalid.GoatedBuyRuntime.diagnostics.length >= 4);
});

test("i18n falls back to English once per missing key", () => {
  const warnings = [];
  const window = runBrowserScript("i18n.js", {});
  const instance = window.GoatedBuyI18n.create("zh-CN", { warn(message) { warnings.push(message); } });
  assert.equal(instance.t("account.sign_in"), "Sign in");
  assert.equal(instance.t("account.sign_in"), "Sign in");
  assert.equal(warnings.length, 1);
  assert.equal(instance.setLocale("not-approved"), "en-US");
});

test("currency formatter keeps integer minor-unit precision", () => {
  const window = runBrowserScript("currency.js", {});
  const formatted = window.GoatedBuyCurrency.formatMinor("9007199254740993123", "USD", "en-US");
  assert.equal(formatted, "$90,071,992,547,409,931.23");
  assert.equal(window.GoatedBuyCurrency.formatMinor("1234", "JPY", "ja-JP").includes("1,234"), true);
  assert.throws(() => window.GoatedBuyCurrency.formatMinor("1.5", "USD"), /integer/);
});

test("client loads config before app and declares restorable guarded account routes", () => {
  const html = readFileSync(new URL("client.html", APP_ROOT), "utf8");
  const app = readFileSync(new URL("app.js", APP_ROOT), "utf8");
  assert.ok(html.indexOf("./config.js") < html.indexOf("./app.js"));
  for (const path of ["/account/login", "/account/register", "/account/verify-email", "/account/verify-device", "/account/settings", "/account/addresses"]) {
    assert.ok(app.includes(path), `missing route ${path}`);
  }
  assert.match(app, /PROTECTED_VIEWS/);
  assert.match(app, /window\.addEventListener\("hashchange"/);
  assert.match(app, /sessionStorage\.getItem\(SESSION_STORAGE_KEY\)/);
});
