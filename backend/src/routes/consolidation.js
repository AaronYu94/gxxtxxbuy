import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-07-04/05/06/07 — value-added-service catalog (super-admin) + user-facing
// eligible stock and draft-parcel creation with reservation.
export function createConsolidationRouter({ authService, consolidationService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const configRead = requireAnyPermission(["config:read", "config:write"]);
  const configWrite = requirePermission("config:write");

  // ---- V2-07-07 value-added service catalog ----
  router.post("/admin/consolidation/value-added-services", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await consolidationService.createValueAddedService(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.patch("/admin/consolidation/value-added-services/:id", adminAuth, configWrite, async (req, res, next) => {
    try { res.json(await consolidationService.updateValueAddedService(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/consolidation/value-added-services", adminAuth, configRead, async (req, res, next) => {
    try { res.json(await consolidationService.listValueAddedServices({})); } catch (error) { next(error); }
  });

  const warehouseWrite = requirePermission("warehouse:write");

  // ---- V2-07-11/12/13 warehouse picking ----
  router.post("/admin/consolidation/parcels/:id/accept", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.acceptForPicking(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/picking/claim", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.claimPicking(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/picking/scan", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.scanPickItem(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/packing/start", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.startPacking(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/value-added-services/execute", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.executeValueAddedService(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/measurement", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.finalizeMeasurement(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/consolidation/parcels/:id/outbound", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await consolidationService.recordOutbound(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/consolidation/parcels/:id", adminAuth, requireAnyPermission(["warehouse:read", "warehouse:write"]), async (req, res, next) => {
    try { res.json(await consolidationService.adminGetParcel(req.params.id)); } catch (error) { next(error); }
  });

  // ---- user-facing ----
  router.get("/api/v2/consolidation/value-added-services", userAuth, async (_req, res, next) => {
    try { res.json(await consolidationService.listValueAddedServices({ enabledOnly: true })); } catch (error) { next(error); }
  });
  router.get("/api/v2/consolidation/eligible-stock", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.listEligibleStock(req.user)); } catch (error) { next(error); }
  });
  router.post("/api/v2/consolidation/parcels", userAuth, async (req, res, next) => {
    try { res.status(201).json(await consolidationService.createParcel(req.user, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/api/v2/consolidation/parcels", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.listMyParcels(req.user)); } catch (error) { next(error); }
  });
  router.get("/api/v2/consolidation/parcels/:id", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.getParcel(req.user, req.params.id)); } catch (error) { next(error); }
  });
  router.post("/api/v2/consolidation/parcels/:id/submit", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.submitParcel(req.user, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/api/v2/consolidation/parcels/:id/packing-fee/pay", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.payPackingBill(req.user, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/api/v2/consolidation/parcels/:id/shipping-fee/pay", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.payShippingBill(req.user, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/api/v2/consolidation/parcels/:id/cancel", userAuth, async (req, res, next) => {
    try { res.json(await consolidationService.cancelParcel(req.user, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
