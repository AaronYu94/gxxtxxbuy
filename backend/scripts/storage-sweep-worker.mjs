import { createEnv } from "../src/config/env.js";
import { createPgWmsRepository } from "../src/wms/wms-repository.js";
import { createPgOrderRepository } from "../src/orders/order-repository.js";
import { createOrderService } from "../src/orders/order-service.js";
import { createPgCatalogRepository } from "../src/catalog/catalog-repository.js";
import { createWmsService } from "../src/wms/wms-service.js";
import { createAuditLogger } from "../src/audit/audit-log.js";
import { createPgAuditRepository } from "../src/audit/audit-repository.js";

// V2-06-17 — storage reminder + overdue-destroy sweep. Idempotent: a repeated run
// never double-notifies (reminders are unique per milestone) and only re-marks
// items still in stock.
export async function runStorageSweep({ env = createEnv({ requireDatabase: true }), logger = console } = {}) {
  const auditLogger = createAuditLogger({ repository: createPgAuditRepository(env), logger });
  const orderRepository = createPgOrderRepository(env);
  const orderService = createOrderService({ repository: orderRepository, catalogRepository: createPgCatalogRepository(env), auditLogger });
  const wms = createWmsService({ repository: createPgWmsRepository(env), orderRepository, orderService, auditLogger });
  const result = await wms.runStorageSweep({});
  logger.info?.(`Storage sweep: ${result.reminded} reminder(s) sent, ${result.marked_for_destroy} marked for destruction.`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStorageSweep({}).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
