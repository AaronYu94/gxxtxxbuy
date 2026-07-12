import express from "express";
import { createPgAccountRepository } from "./account/account-repository.js";
import { createAccountService } from "./account/account-service.js";
import { createAuditLogger } from "./audit/audit-log.js";
import { createPgAdminRepository } from "./admin/admin-repository.js";
import { createAdminService } from "./admin/admin-service.js";
import { createPgAuditRepository } from "./audit/audit-repository.js";
import { createPgAuthRepository } from "./auth/auth-repository.js";
import { createAuthService } from "./auth/auth-service.js";
import { createOAuthService } from "./auth/oauth/oauth-service.js";
import { createEnv } from "./config/env.js";
import { createPgCatalogRepository } from "./catalog/catalog-repository.js";
import { createCatalogService } from "./catalog/catalog-service.js";
import { createPgCoreRepository } from "./core/core-repository.js";
import { createCoreService } from "./core/core-service.js";
import { createPgOrderRepository } from "./orders/order-repository.js";
import { createOrderService } from "./orders/order-service.js";
import { createPgProcurementRepository } from "./procurement/procurement-repository.js";
import { createProcurementService } from "./procurement/procurement-service.js";
import { createPgFinanceRepository } from "./finance/finance-repository.js";
import { createFinanceService } from "./finance/finance-service.js";
import { createStubPaymentProvider } from "./finance/payment-provider.js";
import { createPgWmsRepository } from "./wms/wms-repository.js";
import { createWmsService } from "./wms/wms-service.js";
import { createPgLogisticsRepository } from "./logistics/logistics-repository.js";
import { createLogisticsService } from "./logistics/logistics-service.js";
import { createPgConsolidationRepository } from "./consolidation/consolidation-repository.js";
import { createConsolidationService } from "./consolidation/consolidation-service.js";
import { createPgOutboundRepository } from "./consolidation/outbound-repository.js";
import { createOutboundService } from "./consolidation/outbound-service.js";
import { createPgAfterSalesRepository } from "./after_sales/after-sales-repository.js";
import { createAfterSalesService } from "./after_sales/after-sales-service.js";
import { createPgUserAdminRepository } from "./users_admin/user-admin-repository.js";
import { createUserAdminService } from "./users_admin/user-admin-service.js";
import { createPgUserTagRepository } from "./users_admin/user-tag-repository.js";
import { createUserTagService } from "./users_admin/user-tag-service.js";
import { createPgMembershipRepository } from "./membership/membership-repository.js";
import { createMembershipService } from "./membership/membership-service.js";
import { createPgAccountRiskRepository } from "./account_risk/account-risk-repository.js";
import { createAccountRiskService } from "./account_risk/account-risk-service.js";
import { createPgCouponRepository } from "./promo/coupon-repository.js";
import { createCouponService } from "./promo/coupon-service.js";
import { createPgBannerRepository } from "./promo/banner-repository.js";
import { createBannerService } from "./promo/banner-service.js";
import { createPgCmsRepository } from "./cms/cms-repository.js";
import { createCmsService } from "./cms/cms-service.js";
import { createPgEmailCampaignRepository } from "./promo/email-campaign-repository.js";
import { createEmailCampaignService } from "./promo/email-campaign-service.js";
import { createPgSupportRepository } from "./support/support-repository.js";
import { createSupportService } from "./support/support-service.js";
import { createPgNotificationRepository } from "./ops/notification-repository.js";
import { createNotificationService } from "./ops/notification-service.js";
import { createPgReferralRepository } from "./referral/referral-repository.js";
import { createReferralService } from "./referral/referral-service.js";
import { createPgCommissionRepository } from "./commission/commission-repository.js";
import { createCommissionService } from "./commission/commission-service.js";
import { createPgJobRepository } from "./queue/job-repository.js";
import { createJobService } from "./queue/job-service.js";
import { createPgContentRepository } from "./content/content-repository.js";
import { createContentService } from "./content/content-service.js";
import { createPgCountryRepository } from "./country/country-repository.js";
import { createCountryService } from "./country/country-service.js";
import { createPgCreatorRepository } from "./creators/creator-repository.js";
import { createCreatorService } from "./creators/creator-service.js";
import { createPlaceholderProductSource } from "./parsing/product-source.js";
import { createNotConfiguredProductSource } from "./parsing/adapters/registry.js";
import { createPgRiskRepository } from "./risk/risk-repository.js";
import { createRiskService } from "./risk/risk-service.js";
import { checkDatabase } from "./db/pool.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createOpenApiDocument } from "./openapi/document.js";
import { eventCatalog } from "./openapi/event-catalog.js";
import { checkRedis } from "./queue/redis.js";
import { createAdminAuthRouter } from "./routes/admin-auth.js";
import { createAdminConsoleRouter } from "./routes/admin-console.js";
import { createAdminSecurityRouter } from "./routes/admin-security.js";
import { createAccountRouter } from "./routes/account.js";
import { createAuthRouter } from "./routes/auth.js";
import { createOAuthRouter } from "./routes/oauth.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createOrderRouter } from "./routes/orders.js";
import { createProcurementRouter } from "./routes/procurement.js";
import { createFinanceRouter } from "./routes/finance.js";
import { createWmsRouter } from "./routes/wms.js";
import { createLogisticsRouter } from "./routes/logistics.js";
import { createConsolidationRouter } from "./routes/consolidation.js";
import { createOutboundRouter } from "./routes/outbound.js";
import { createAfterSalesRouter } from "./routes/after-sales.js";
import { createUserAdminRouter } from "./routes/user-admin.js";
import { createUserTagRouter } from "./routes/user-tags.js";
import { createMembershipRouter } from "./routes/membership.js";
import { createAccountRiskRouter } from "./routes/account-risk.js";
import { createCouponRouter } from "./routes/coupons.js";
import { createBannerRouter } from "./routes/banners.js";
import { createCmsRouter } from "./routes/cms.js";
import { createEmailCampaignRouter } from "./routes/email-campaigns.js";
import { createSupportRouter } from "./routes/support.js";
import { createNotificationRouter } from "./routes/notifications.js";
import { createReferralRouter } from "./routes/referral.js";
import { createCommissionRouter } from "./routes/commission.js";
import { createJobRouter } from "./routes/jobs.js";
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
    account: options.repositories?.account || createPgAccountRepository(env),
    audit: options.repositories?.audit || createPgAuditRepository(env),
    core: options.repositories?.core || createPgCoreRepository(env),
    catalog: options.repositories?.catalog || createPgCatalogRepository(env),
    order: options.repositories?.order || createPgOrderRepository(env),
    procurement: options.repositories?.procurement || createPgProcurementRepository(env),
    finance: options.repositories?.finance || createPgFinanceRepository(env),
    wms: options.repositories?.wms || createPgWmsRepository(env),
    logistics: options.repositories?.logistics || createPgLogisticsRepository(env),
    consolidation: options.repositories?.consolidation || createPgConsolidationRepository(env),
    outbound: options.repositories?.outbound || createPgOutboundRepository(env),
    afterSales: options.repositories?.afterSales || createPgAfterSalesRepository(env),
    userAdmin: options.repositories?.userAdmin || createPgUserAdminRepository(env),
    userTag: options.repositories?.userTag || createPgUserTagRepository(env),
    membership: options.repositories?.membership || createPgMembershipRepository(env),
    accountRisk: options.repositories?.accountRisk || createPgAccountRiskRepository(env),
    coupon: options.repositories?.coupon || createPgCouponRepository(env),
    banner: options.repositories?.banner || createPgBannerRepository(env),
    cms: options.repositories?.cms || createPgCmsRepository(env),
    emailCampaign: options.repositories?.emailCampaign || createPgEmailCampaignRepository(env),
    support: options.repositories?.support || createPgSupportRepository(env),
    notification: options.repositories?.notification || createPgNotificationRepository(env),
    referral: options.repositories?.referral || createPgReferralRepository(env),
    commission: options.repositories?.commission || createPgCommissionRepository(env),
    job: options.repositories?.job || createPgJobRepository(env),
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
  const referralService = options.referralService || createReferralService({
    repository: repositories.referral,
    officialBaseUrl: env.officialBaseUrl || "https://goatedbuy.example",
    auditLogger
  });
  const authService = options.authService || createAuthService({
    repository: repositories.auth,
    auditLogger,
    env,
    notifier: options.notifier,
    // V2-11-03 — bind an inviter at signup (invalid code never blocks registration).
    referralBinder: (userId, refCode) => referralService.bindOnSignup(userId, refCode, "signup")
  });
  const oauthService = options.oauthService || createOAuthService({ authService, env });
  const productSource = options.productSource || createPlaceholderProductSource();
  // Catalog (V2-03) uses the adapter registry. No approved provider is wired
  // until GB-DEC-P0-004, so the default registry degrades to not_configured.
  const productSourceRegistry = options.productSourceRegistry || createNotConfiguredProductSource();
  const accountService = options.accountService || createAccountService({
    repository: repositories.account,
    auditLogger,
    env
  });
  const coreService = options.coreService || createCoreService({
    repository: repositories.core,
    env,
    queue: options.queue,
    auditLogger,
    productSource,
    parseInline: options.parseInline ?? env.linkParseInline
  });
  const catalogService = options.catalogService || createCatalogService({
    repository: repositories.catalog,
    registry: productSourceRegistry,
    env,
    queue: options.queue,
    auditLogger,
    parseInline: options.parseInline ?? env.linkParseInline
  });
  const procurementService = options.procurementService || createProcurementService({
    repository: repositories.procurement,
    orderRepository: repositories.order,
    auditLogger
  });
  const orderService = options.orderService || createOrderService({
    repository: repositories.order,
    catalogRepository: repositories.catalog,
    auditLogger,
    accountPicker: (platform) => procurementService.pickAccountForPlatform(platform)
  });
  const paymentProvider = options.paymentProvider
    || createStubPaymentProvider({ secret: env.paymentWebhookSecret || "goatedbuy-dev-payment-secret" });
  const financeService = options.financeService || createFinanceService({
    repository: repositories.finance,
    auditLogger,
    paymentProvider,
    orderService,
    env
  });
  const wmsService = options.wmsService || createWmsService({
    repository: repositories.wms,
    orderRepository: repositories.order,
    orderService,
    financeService,
    auditLogger
  });
  const logisticsService = options.logisticsService || createLogisticsService({
    repository: repositories.logistics,
    auditLogger
  });
  const membershipService = options.membershipService || createMembershipService({
    repository: repositories.membership,
    auditLogger
  });
  const couponService = options.couponService || createCouponService({
    repository: repositories.coupon,
    auditLogger
  });
  const bannerService = options.bannerService || createBannerService({
    repository: repositories.banner,
    auditLogger
  });
  const cmsService = options.cmsService || createCmsService({
    repository: repositories.cms,
    auditLogger
  });
  const emailCampaignService = options.emailCampaignService || createEmailCampaignService({
    repository: repositories.emailCampaign,
    auditLogger
  });
  const supportService = options.supportService || createSupportService({
    repository: repositories.support,
    userLookup: repositories.userAdmin,
    auditLogger
  });
  const notificationService = options.notificationService || createNotificationService({
    repository: repositories.notification
  });
  const consolidationService = options.consolidationService || createConsolidationService({
    repository: repositories.consolidation,
    addressRepository: repositories.account,
    orderService,
    financeService,
    logisticsService,
    membershipService,
    membershipProvider: membershipService.membershipProvider(),
    couponService,
    auditLogger
  });
  const commissionService = options.commissionService || createCommissionService({
    repository: repositories.commission,
    referralService,
    financeService,
    auditLogger
  });
  const jobService = options.jobService || createJobService({ repository: repositories.job, auditLogger });
  const outboundService = options.outboundService || createOutboundService({
    repository: repositories.outbound,
    orderService,
    // V2-11-07 — on a signed (delivered) parcel, generate promoter commission.
    commissionHook: async (parcelId) => {
      const base = await repositories.consolidation.commissionBaseForParcel(parcelId);
      if (base) await commissionService.generateOnSigned({ parcelId, inviteeUserId: base.userId, baseMinor: base.baseMinor });
    },
    auditLogger
  });
  const afterSalesService = options.afterSalesService || createAfterSalesService({
    repository: repositories.afterSales,
    orderRepository: repositories.order,
    orderService,
    financeService,
    auditLogger
  }); // financeService already declared above
  const userAdminService = options.userAdminService || createUserAdminService({
    repository: repositories.userAdmin,
    auditLogger
  });
  const userTagService = options.userTagService || createUserTagService({
    repository: repositories.userTag,
    auditLogger
  });
  const accountRiskService = options.accountRiskService || createAccountRiskService({
    repository: repositories.accountRisk,
    auditLogger,
    autoRulesEnabled: env.riskAutoRulesEnabled === true
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

  // V2-12-07 — the domain event + error-code catalog (single source of truth).
  app.get("/openapi/events", (_req, res) => {
    res.json(eventCatalog());
  });

  app.use(createAuthRouter({ authService }));
  app.use(createOAuthRouter({ authService, oauthService, env }));
  app.use(createAccountRouter({ authService, accountService }));
  app.use(createAdminAuthRouter({ authService }));
  app.use(createAdminSecurityRouter({ authService }));
  app.use(createAdminConsoleRouter({ authService, adminService }));
  app.use(createClientCoreRouter({ authService, coreService }));
  app.use(createCatalogRouter({ authService, catalogService }));
  app.use(createOrderRouter({ authService, orderService }));
  app.use(createProcurementRouter({ authService, procurementService, orderService }));
  app.use(createFinanceRouter({ authService, financeService }));
  app.use(createWmsRouter({ authService, wmsService }));
  app.use(createLogisticsRouter({ authService, logisticsService }));
  app.use(createConsolidationRouter({ authService, consolidationService }));
  app.use(createOutboundRouter({ authService, outboundService }));
  app.use(createAfterSalesRouter({ authService, afterSalesService }));
  app.use(createUserAdminRouter({ authService, userAdminService }));
  app.use(createUserTagRouter({ authService, userTagService }));
  app.use(createMembershipRouter({ authService, membershipService }));
  app.use(createAccountRiskRouter({ authService, accountRiskService }));
  app.use(createCouponRouter({ authService, couponService }));
  app.use(createBannerRouter({ authService, bannerService }));
  app.use(createCmsRouter({ authService, cmsService }));
  app.use(createEmailCampaignRouter({ authService, emailCampaignService, env }));
  app.use(createSupportRouter({ authService, supportService, env }));
  app.use(createNotificationRouter({ authService, notificationService }));
  app.use(createReferralRouter({ authService, referralService }));
  app.use(createCommissionRouter({ authService, commissionService }));
  app.use(createJobRouter({ authService, jobService }));
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
