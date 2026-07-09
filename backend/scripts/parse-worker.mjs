// Standalone link-parse worker. Drains the links:parse queue and resolves each saved
// link through the configured product source (placeholder by default). Run this as its
// own process once Redis is configured; in demo/dev without Redis, set LINK_PARSE_INLINE=true
// instead and the core service resolves links inline.
//
//   DATABASE_URL=... REDIS_URL=... npm run worker:parse
import { createEnv } from "../src/config/env.js";
import { createPgCoreRepository } from "../src/core/core-repository.js";
import { createParseWorker } from "../src/parsing/parse-worker.js";
import { createPlaceholderProductSource } from "../src/parsing/product-source.js";

const env = createEnv();
const repository = createPgCoreRepository(env);
const source = createPlaceholderProductSource();
const worker = createParseWorker({ env, repository, source });

const IDLE_MS = 1000;
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

console.log(JSON.stringify({ event: "parse_worker_started", source: source.name }));

while (running) {
  let processed = null;
  try {
    processed = await worker.runOnce();
  } catch (error) {
    console.error(JSON.stringify({ event: "parse_worker_error", message: error.message }));
  }
  if (processed) {
    console.log(JSON.stringify({ event: "link_parsed", link_id: processed.id, status: processed.status }));
  } else {
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
}

console.log(JSON.stringify({ event: "parse_worker_stopped" }));
