import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { createOpenApiDocument } from "../src/openapi/document.js";
import { validateOpenApiDocument } from "./validate-openapi.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

if (packageJson.name !== packageLock.name) {
  throw new Error("package-lock.json does not match package.json name.");
}

for (const script of ["start", "test", "lint", "openapi:check"]) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Missing package script: ${script}`);
  }
}

const env = parseEnv({
  NODE_ENV: "test",
  SERVICE_NAME: "goatedbuy-backend",
  APP_VERSION: packageJson.version,
  PORT: "3000",
  REQUEST_LOG_LEVEL: "silent",
  READY_REQUIRES_DATABASE: "false",
  READY_REQUIRES_REDIS: "false"
});

const app = createApp({ env });
if (typeof app.listen !== "function") {
  throw new Error("Express app did not initialize.");
}

const openapiErrors = validateOpenApiDocument(createOpenApiDocument(env));
if (openapiErrors.length) {
  throw new Error(`OpenAPI validation failed: ${openapiErrors.join("; ")}`);
}

console.log(`Build check ok: ${packageJson.name}@${packageJson.version}`);
