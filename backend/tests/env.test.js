import assert from "node:assert/strict";
import test from "node:test";
import { EnvError, parseEnv } from "../src/config/env.js";
import { redactHeaders, redactUrl } from "../src/utils/redact.js";

test("parseEnv applies safe defaults", () => {
  const env = parseEnv({});
  assert.equal(env.nodeEnv, "development");
  assert.equal(env.port, 3000);
  assert.equal(env.readyRequiresDatabase, true);
});

test("parseEnv rejects invalid port", () => {
  assert.throws(() => parseEnv({ PORT: "nope" }), EnvError);
});

test("parseEnv can require DATABASE_URL for DB commands", () => {
  assert.throws(() => parseEnv({}, { requireDatabase: true }), /DATABASE_URL is required/);
});

test("redaction hides credentials and sensitive headers", () => {
  assert.equal(
    redactUrl("postgres://user:secret@localhost:5432/app"),
    "postgres://%5BUSER%5D:%5BREDACTED%5D@localhost:5432/app"
  );
  assert.deepEqual(redactHeaders({ Authorization: "Bearer secret", "User-Agent": "test" }), {
    authorization: "[REDACTED]",
    "user-agent": "test"
  });
});
