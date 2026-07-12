// Standalone catalog parse worker (V2-03-06). Drains the catalog:parse queue and
// resolves each job through the product-source registry. With no approved provider
// (GB-DEC-P0-004 pending) every job degrades to manual — the worker never
// fabricates supplier data. Once a licensed provider is wired via
// createProductSourceRegistry({ providers }), the same worker produces snapshots.
//
//   DATABASE_URL=... REDIS_URL=... npm run worker:catalog-parse
import { createEnv } from "../src/config/env.js";
import { createPgCatalogRepository } from "../src/catalog/catalog-repository.js";
import { createCatalogService } from "../src/catalog/catalog-service.js";
import { createNotConfiguredProductSource } from "../src/parsing/adapters/registry.js";
import { createCatalogParseWorker } from "../src/catalog/parse-queue.js";

const env = createEnv();
const repository = createPgCatalogRepository(env);
const registry = createNotConfiguredProductSource();
const service = createCatalogService({ repository, registry, env });
const worker = createCatalogParseWorker({ env, service });

const IDLE_MS = 1000;
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

console.log(JSON.stringify({ event: "catalog_parse_worker_started", configured: registry.configured }));

while (running) {
  let processed = null;
  try {
    processed = await worker.runOnce();
  } catch (error) {
    console.error(JSON.stringify({ event: "catalog_parse_worker_error", message: error.message }));
  }
  if (processed) {
    console.log(JSON.stringify({ event: "catalog_job_processed", job_id: processed.id, status: processed.status, reason: processed.reason }));
  } else {
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
}

console.log(JSON.stringify({ event: "catalog_parse_worker_stopped" }));
