import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-06 — inbound scanning + measurement (admin) and the user's inbound list.
export function createWmsRouter({ authService, wmsService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const warehouseRead = requireAnyPermission(["warehouse:read", "warehouse:write"]);
  const warehouseWrite = requirePermission("warehouse:write");

  router.post("/admin/wms/inbound/scan", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      const result = await wmsService.scanArrival(req.adminUser, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/wms/inbound/unclaimed", adminAuth, warehouseRead, async (req, res, next) => {
    try {
      res.json(await wmsService.listUnclaimed());
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/inbound/:id/link", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.manualLink(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/inbound/:id/measure", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.submitMeasurement(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/inbound", userAuth, async (req, res, next) => {
    try {
      res.json(await wmsService.listMyPackages(req.user));
    } catch (error) {
      next(error);
    }
  });

  // V2-06-05/06/07 QC task workbench.
  router.get("/admin/wms/qc/tasks", adminAuth, warehouseRead, async (req, res, next) => {
    try {
      res.json(await wmsService.listQcTasks(req.query, req.adminUser));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/wms/qc/tasks/:id", adminAuth, warehouseRead, async (req, res, next) => {
    try {
      res.json(await wmsService.getQcTask(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/qc/tasks/:id/claim", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.claimQc(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/qc/tasks/:id/start", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.startQc(req.adminUser, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/qc/tasks/:id/release", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.releaseQc(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/qc/tasks/:id/photo", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.status(201).json(await wmsService.uploadQcPhoto(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-06-11 QC completion + official warehousing.
  router.post("/admin/wms/qc/tasks/:id/complete", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.completeQc(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/inventory", userAuth, async (req, res, next) => {
    try {
      res.json(await wmsService.listMyInventory(req.user));
    } catch (error) {
      next(error);
    }
  });

  // V2-06-16 storage status + paid extension (user).
  router.get("/api/v2/inventory/:stockNo/storage", userAuth, async (req, res, next) => {
    try { res.json(await wmsService.getStorageStatus(req.user, req.params.stockNo)); } catch (error) { next(error); }
  });
  router.post("/api/v2/inventory/:stockNo/extend-storage", userAuth, async (req, res, next) => {
    try {
      const result = await wmsService.buyStorageExtension(req.user, req.params.stockNo, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });

  // V2-06-18 mark + execute destruction (warehouse).
  router.post("/admin/wms/inventory/:stockNo/mark-destroy", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.markForDestroy(req.adminUser, req.params.stockNo, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/wms/inventory/:stockNo/destroy", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.executeDestroy(req.adminUser, req.params.stockNo, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // V2-06-12/13/14/15 locations + double-scan + shipping restrictions.
  router.post("/admin/wms/locations", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.status(201).json(await wmsService.createLocation(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/wms/locations", adminAuth, warehouseRead, async (req, res, next) => {
    try { res.json(await wmsService.listLocations()); } catch (error) { next(error); }
  });
  router.post("/admin/wms/locations/:id/disable", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.disableLocation(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/wms/inventory/assign-location", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.assignLocation(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/wms/inventory/move-location", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.moveLocation(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/wms/inventory/shipping-restrictions", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await wmsService.setShippingRestrictions(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // V2-06-10 QC exceptions (assignee).
  router.post("/admin/wms/qc/tasks/:id/exception", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.status(201).json(await wmsService.raiseQcException(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/wms/qc/tasks/:id/exception/resolve", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await wmsService.resolveQcException(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-06-08/09 paid QC add-ons (user).
  router.post("/api/v2/qc/:itemId/extra-photos", userAuth, async (req, res, next) => {
    try {
      const result = await wmsService.buyExtraPhotos(req.user, req.params.itemId, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/qc/:itemId/detailed", userAuth, async (req, res, next) => {
    try {
      const result = await wmsService.buyDetailedCheck(req.user, req.params.itemId, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
