import assert from "node:assert/strict";
import test from "node:test";
import { referencedVars, validateTemplate, render } from "../src/cms/template-render.js";
import { createCmsService } from "../src/cms/cms-service.js";
import { MemoryCmsRepository } from "./helpers/memory-cms-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };
const OPS = ["campaign_operator"];
const SUPER = ["super_admin"];

// ---- V2-10-07 pure template ----
test("template variable extraction, validation, and rendering", () => {
  assert.deepEqual(referencedVars("Hi {{name}}", "Order {{order_no}} shipped").sort(), ["name", "order_no"]);
  assert.equal(validateTemplate({ subject: "Hi {{name}}", body: "x", variables: ["name"] }).ok, true);
  assert.equal(validateTemplate({ subject: "Hi {{name}}", body: "{{secret}}", variables: ["name"] }).ok, false);
  const r = render({ subject: "Hi {{name}}", body: "You have {{count}} items" }, { name: "Jane", count: 3 });
  assert.equal(r.subject, "Hi Jane");
  assert.equal(r.body, "You have 3 items");
  // Unknown placeholders render empty.
  assert.equal(render({ subject: "{{gone}}", body: "" }, {}).subject, "");
});

function build() {
  const repository = new MemoryCmsRepository();
  const svc = createCmsService({ repository });
  return { repository, svc };
}

test("publishing a template with an undeclared variable is blocked", async () => {
  const { svc } = build();
  const t = (await svc.createTemplate(ADMIN, OPS, { code: "welcome", language: "en", subject: "Hi {{name}}", body: "Code {{secret}}", variables: ["name"] })).template;
  await assert.rejects(() => svc.publishTemplate(ADMIN, OPS, t.id), (e) => e.statusCode === 400);
});

test("template resolution falls back to the default language", async () => {
  const { svc } = build();
  const en = (await svc.createTemplate(ADMIN, OPS, { code: "welcome", language: "en", subject: "Hi {{name}}", body: "b", variables: ["name"] })).template;
  await svc.publishTemplate(ADMIN, OPS, en.id);
  // No 'fr' template → falls back to 'en'.
  const rendered = await svc.renderTemplate("welcome", "fr", { name: "Marie" });
  assert.equal(rendered.language, "en");
  assert.equal(rendered.subject, "Hi Marie");
  assert.equal(rendered.template_version, 1);
});

// ---- V2-10-11 config version center ----
test("config publish is super-admin only and pins historical versions", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.publishConfigDoc(ADMIN, OPS, { kind: "agreement", doc_key: "tos", language: "en", reason: "x", content: { text: "v1" } }), (e) => e.statusCode === 403);
  const v1 = (await svc.publishConfigDoc(ADMIN, SUPER, { kind: "agreement", doc_key: "tos", language: "en", reason: "launch", content: { text: "v1" } })).document;
  const v2 = (await svc.publishConfigDoc(ADMIN, SUPER, { kind: "agreement", doc_key: "tos", language: "en", reason: "update", content: { text: "v2" } })).document;
  assert.equal(v2.version, 2);
  // Active read is the latest.
  assert.equal((await svc.getConfigDoc("agreement", "tos", "en")).document.version, 2);
  // Historical business can pin v1.
  assert.equal((await svc.getConfigDocVersion("agreement", "tos", "en", 1)).document.content.text, "v1");
});

test("publish reason is mandatory for config docs", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.publishConfigDoc(ADMIN, SUPER, { kind: "notice", doc_key: "n", language: "en", content: {} }), (e) => e.statusCode === 400);
});
