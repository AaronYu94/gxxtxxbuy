import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createOpenApiDocument } from "../src/openapi/document.js";
import { lintMigration, lintMigrations } from "../src/db/migration-lint.js";
import { EVENT_CATALOG, eventCatalog } from "../src/openapi/event-catalog.js";

// Collect every route (method + path) registered on the Express app.
function collectRoutes(app) {
  const routes = [];
  const walk = (stack, prefix = "") => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          if (layer.route.methods[method]) routes.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };
  // Express 5 exposes the internal router as app.router; Express 4 used app._router.
  const stack = (app.router && app.router.stack) || (app._router && app._router.stack) || [];
  walk(stack);
  return routes;
}

// Normalise an Express path (":id") to an OpenAPI path ("{id}").
function toOpenApiPath(p) { return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}"); }

// ---- V2-12-07 no undocumented write endpoint ----
test("every mutating route (POST/PATCH/PUT/DELETE) is documented in OpenAPI", () => {
  const app = createApp({});
  const doc = createOpenApiDocument(app.locals?.env || {});
  const documented = new Set(Object.keys(doc.paths));
  const routes = collectRoutes(app);
  const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
  // Infra / health / static endpoints that are intentionally not in the resource doc.
  const EXEMPT = new Set(["/", "/openapi.json"]);
  const missing = [];
  for (const r of routes) {
    if (!writeMethods.has(r.method)) continue;
    const oapiPath = toOpenApiPath(r.path);
    if (EXEMPT.has(oapiPath)) continue;
    if (!documented.has(oapiPath)) missing.push(`${r.method} ${oapiPath}`);
  }
  assert.deepEqual(missing, [], `Undocumented write endpoints:\n${missing.join("\n")}`);
});

test("the event catalog and error-code families are present", () => {
  const cat = eventCatalog();
  assert.ok(cat.events.length >= 15);
  assert.ok(cat.events.every((e) => e.event && e.trigger && e.example));
  assert.ok(cat.error_code_families.includes("insufficient_available"));
  assert.ok(EVENT_CATALOG.some((e) => e.event === "commission.generated"));
});

// ---- V2-12-08 migration drill: destructive guard + checksum awareness ----
test("the destructive-migration lint blocks unapproved drops/truncates", () => {
  assert.equal(lintMigration("create table x (id int);").destructive, false);
  assert.equal(lintMigration("drop trigger if exists t on x;").destructive, false); // routine
  const bad = lintMigration("drop table users;");
  assert.equal(bad.destructive, true);
  assert.equal(bad.blocked, true);
  const approved = lintMigration("-- @destructive-approved\ndrop table old_temp;");
  assert.equal(approved.blocked, false); // explicit approval clears it
});

test("no committed migration contains an unapproved destructive statement", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const migrations = files.map((f) => ({ file: f, sql: readFileSync(new URL(f, dir), "utf8") }));
  const res = lintMigrations(migrations);
  assert.equal(res.ok, true, `Destructive migrations found:\n${JSON.stringify(res.blocked, null, 2)}`);
});
