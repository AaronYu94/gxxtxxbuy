import express from "express";
import { requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-07-18/19/20 — outbound batches, handoff writeback, tracking sync (warehouse).
export function createOutboundRouter({ authService, outboundService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const warehouseRead = requireAnyPermission(["warehouse:read", "warehouse:write"]);
  const warehouseWrite = requirePermission("warehouse:write");

  router.post("/admin/outbound/batches", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.status(201).json(await outboundService.createBatch(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/outbound/batches", adminAuth, warehouseRead, async (req, res, next) => {
    try { res.json(await outboundService.listBatches(req.query)); } catch (error) { next(error); }
  });
  router.get("/admin/outbound/batches/:id", adminAuth, warehouseRead, async (req, res, next) => {
    try { res.json(await outboundService.getBatch(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/batches/:id/load", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.loadParcel(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/batches/:id/handoff-pending", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.markHandoffPending(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/batches/:id/handoff", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.confirmHandoff(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/batches/:id/complete", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.completeBatch(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/batches/:id/cancel", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.cancelBatch(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/outbound/tracking/sync", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await outboundService.syncTracking(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
