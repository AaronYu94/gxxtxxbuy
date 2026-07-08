import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { createOpenApiDocument } from "../src/openapi/document.js";
import { validateOpenApiDocument } from "../scripts/validate-openapi.mjs";

test("OpenAPI document validates locally", () => {
  const document = createOpenApiDocument({
    serviceName: "goatedbuy-backend",
    appVersion: "0.1.0"
  });
  assert.deepEqual(validateOpenApiDocument(document), []);
});

test("/openapi.json serves the maintained API document", async () => {
  const env = parseEnv({
    NODE_ENV: "test",
    PORT: "3000",
    REQUEST_LOG_LEVEL: "silent",
    READY_REQUIRES_DATABASE: "false",
    READY_REQUIRES_REDIS: "false"
  });
  const app = createApp({ env });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/openapi.json`);
    const document = await response.json();
    assert.equal(response.status, 200);
    assert.equal(document.openapi, "3.1.0");
    assert.ok(document.paths["/health"]);
    assert.deepEqual(validateOpenApiDocument(document), []);
  } finally {
    server.close();
  }
});
