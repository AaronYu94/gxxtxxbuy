import { createEnv } from "../src/config/env.js";
import { createPgOrderRepository } from "../src/orders/order-repository.js";
import { createPgCatalogRepository } from "../src/catalog/catalog-repository.js";
import { createOrderService } from "../src/orders/order-service.js";
import { createAuditLogger } from "../src/audit/audit-log.js";
import { createPgAuditRepository } from "../src/audit/audit-repository.js";

// V2-04-13 — cancel purchase exceptions whose 24h deadline lapsed with no user
// response. Idempotent (already-handled exceptions are skipped), retries a few
// times on transient failure, and surfaces a non-zero exit so the cron/alerting
// layer notices a persistent failure.
export async function runExceptionAutoCancel({ env = createEnv({ requireDatabase: true }), logger = console, attempts = 3 } = {}) {
  const auditLogger = createAuditLogger({ repository: createPgAuditRepository(env), logger });
  const service = createOrderService({
    repository: createPgOrderRepository(env),
    catalogRepository: createPgCatalogRepository(env),
    auditLogger
  });

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await service.autoCancelExpiredExceptions({});
      logger.info?.(`Auto-cancelled ${result.cancelled} expired exception(s).`);
      return result;
    } catch (error) {
      lastError = error;
      logger.warn?.(`Auto-cancel attempt ${attempt} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  logger.error?.(`Exception auto-cancel failed after ${attempts} attempts: ${lastError?.message}`);
  throw lastError;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExceptionAutoCancel({}).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
