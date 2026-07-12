import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-07-01/02/03 — logistics config (admin/super-admin) + user-facing quote.
export function createLogisticsRouter({ authService, logisticsService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const configRead = requireAnyPermission(["config:read", "config:write"]);
  const configWrite = requirePermission("config:write");

  router.post("/admin/logistics/carriers", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await logisticsService.createCarrier(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/logistics/carriers", adminAuth, configRead, async (req, res, next) => {
    try { res.json(await logisticsService.listCarriers()); } catch (error) { next(error); }
  });
  router.post("/admin/logistics/routes", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await logisticsService.createRoute(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/logistics/routes/:code/price", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await logisticsService.setPriceVersion(req.adminUser, req.adminRoles, req.params.code, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/logistics/routes/:code/price-versions", adminAuth, configRead, async (req, res, next) => {
    try { res.json(await logisticsService.listPriceVersions(req.params.code)); } catch (error) { next(error); }
  });

  // User-facing route list + freight quote.
  router.get("/api/v2/logistics/routes", userAuth, async (req, res, next) => {
    try { res.json(await logisticsService.listRoutes(req.query)); } catch (error) { next(error); }
  });
  router.post("/api/v2/logistics/quote", userAuth, async (req, res, next) => {
    try { res.json(await logisticsService.quote(req.body)); } catch (error) { next(error); }
  });

  return router;
}
