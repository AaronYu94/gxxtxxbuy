import express from "express";
import { createAuditLogger } from "./audit/audit-log.js";
import { createPgAdminRepository } from "./admin/admin-repository.js";
import { createAdminService } from "./admin/admin-service.js";
import { createPgAuditRepository } from "./audit/audit-repository.js";
import { createPgAuthRepository } from "./auth/auth-repository.js";
import { createAuthService } from "./auth/auth-service.js";
import { createEnv } from "./config/env.js";
import { createPgCoreRepository } from "./core/core-repository.js";
import { createCoreService } from "./core/core-service.js";
import { createPgContentRepository } from "./content/content-repository.js";
import { createContentService } from "./content/content-service.js";
import { createPgCountryRepository } from "./country/country-repository.js";
import { createCountryService } from "./country/country-service.js";
import { createPgCreatorRepository } from "./creators/creator-repository.js";
import { createCreatorService } from "./creators/creator-service.js";
import { createPgRiskRepository } from "./risk/risk-repository.js";
import { createRiskService } from "./risk/risk-service.js";
import { checkDatabase } from "./db/pool.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createOpenApiDocument } from "./openapi/document.js";
import { checkRedis } from "./queue/redis.js";
import { createAdminAuthRouter } from "./routes/admin-auth.js";
import { createAdminConsoleRouter } from "./routes/admin-console.js";
import { createAuthRouter } from "./routes/auth.js";
import { createClientCoreRouter } from "./routes/client-core.js";
import { createContentRouter } from "./routes/content.js";
import { createCountryRouter } from "./routes/country.js";
import { createCreatorRouter } from "./routes/creators.js";
import { createRiskRouter } from "./routes/risk.js";
import { createShippingRouter } from "./routes/shipping.js";
import { createStorageRouter } from "./routes/storage.js";
import { createSystemRouter } from "./routes/system.js";
import { createWalletRouter } from "./routes/wallet.js";
import { createWarehouseRouter } from "./routes/warehouse.js";
import { createPgShippingRepository } from "./shipping/shipping-repository.js";
import { createShippingService } from "./shipping/shipping-service.js";
import { createStorageAdapter } from "./storage/storage-adapter.js";
import { createSignedUrlHelper } from "./storage/signed-url.js";
import { createPgWarehouseRepository } from "./warehouse/warehouse-repository.js";
import { createWarehouseService } from "./warehouse/warehouse-service.js";
import { createPgWalletRepository } from "./wallet/wallet-repository.js";
import { createWalletService } from "./wallet/wallet-service.js";

export function createApp(options = {}) {
  const env = options.env || createEnv();
  const logger = options.logger || console;
  const services = {
    checkDatabase: options.services?.checkDatabase || (() => checkDatabase(env)),
    checkRedis: options.services?.checkRedis || (() => checkRedis(env))
  };
  const repositories = {
    auth: options.repositories?.auth || createPgAuthRepository(env),
    audit: options.repositories?.audit || createPgAuditRepository(env),
    core: options.repositories?.core || createPgCoreRepository(env),
    warehouse: options.repositories?.warehouse || createPgWarehouseRepository(env),
    shipping: options.repositories?.shipping || createPgShippingRepository(env),
    wallet: options.repositories?.wallet || createPgWalletRepository(env),
    admin: options.repositories?.admin || createPgAdminRepository(env),
    creator: options.repositories?.creator || createPgCreatorRepository(env),
    content: options.repositories?.content || createPgContentRepository(env),
    risk: options.repositories?.risk || createPgRiskRepository(env),
    country: options.repositories?.country || createPgCountryRepository(env)
  };
  const storage = options.storage || createStorageAdapter(env);
  const signedUrlHelper = options.signedUrlHelper || createSignedUrlHelper(env);
  const auditLogger = options.auditLogger || createAuditLogger({ repository: repositories.audit, logger });
  const authService = options.authService || createAuthService({
    repository: repositories.auth,
    auditLogger
  });
  const coreService = options.coreService || createCoreService({
    repository: repositories.core,
    env,
    queue: options.queue,
    auditLogger
  });
  const warehouseService = options.warehouseService || createWarehouseService({
    repository: repositories.warehouse,
    storage,
    signedUrlHelper,
    auditLogger
  });
  const walletService = options.walletService || createWalletService({
    repository: repositories.wallet,
    env,
    auditLogger
  });
  const shippingService = options.shippingService || createShippingService({
    repository: repositories.shipping,
    env,
    couponService: walletService,
    auditLogger
  });
  const adminService = options.adminService || createAdminService({
    repository: repositories.admin,
    auditLogger
  });
  const creatorService = options.creatorService || createCreatorService({
    repository: repositories.creator,
    auditLogger
  });
  const contentService = options.contentService || createContentService({
    repository: repositories.content,
    auditLogger
  });
  const riskService = options.riskService || createRiskService({
    repository: repositories.risk,
    env,
    auditLogger
  });
  const countryService = options.countryService || createCountryService({
    repository: repositories.country,
    auditLogger
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(corsMiddleware({ allowedOrigins: env.corsAllowedOrigins }));
  app.use(express.json({ limit: "12mb" }));
  app.use(requestLogger({ logger, logLevel: env.logLevel }));

  app.get("/", (_req, res) => {
    res.json({
      service: env.serviceName,
      version: env.appVersion,
      links: {
        health: "/health",
        openapi: "/openapi.json",
        ready: "/ready",
        version: "/version"
      }
    });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(createOpenApiDocument(env));
  });

  app.use(createAuthRouter({ authService }));
  app.use(createAdminAuthRouter({ authService }));
  app.use(createAdminConsoleRouter({ authService, adminService }));
  app.use(createClientCoreRouter({ authService, coreService }));
  app.use(createStorageRouter({ storage, signedUrlHelper }));
  app.use(createWarehouseRouter({ authService, warehouseService }));
  app.use(createShippingRouter({ authService, shippingService, env }));
  app.use(createWalletRouter({ authService, walletService, env }));
  app.use(createCreatorRouter({ authService, creatorService, env }));
  app.use(createContentRouter({ authService, contentService }));
  app.use(createRiskRouter({ authService, riskService }));
  app.use(createCountryRouter({ authService, countryService }));
  app.use(createSystemRouter({ env, services }));
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
}
