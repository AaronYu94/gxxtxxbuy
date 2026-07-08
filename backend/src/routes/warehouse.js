import { Router } from "express";
import { requireAdmin, requirePermission, requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createWarehouseRouter({ authService, warehouseService }) {
  const router = Router();
  const adminAuth = requireAdmin(authService);
  const userAuth = requireUser(authService);
  const warehouseWrite = requirePermission("warehouse:write");

  router.post("/admin/warehouse/items/:id/receive", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      const result = await warehouseService.receiveItem(req.adminUser, req.params.id, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/warehouse/items/:id/weight", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      res.json(await warehouseService.updateWeight(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/qc/items/:id/photos", adminAuth, warehouseWrite, async (req, res, next) => {
    try {
      const result = await warehouseService.uploadQcPhotos(req.adminUser, req.params.id, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/qc/items", userAuth, async (req, res, next) => {
    try {
      res.json(await warehouseService.listUserQcItems(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/qc/items/:id/approve", userAuth, async (req, res, next) => {
    try {
      res.json(await warehouseService.approveQc(req.user, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/qc/items/:id/extra-photo", userAuth, async (req, res, next) => {
    try {
      const result = await warehouseService.requestExtraPhoto(req.user, req.params.id, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/warehouse/items/:id/storage", userAuth, async (req, res, next) => {
    try {
      res.json(await warehouseService.getStorageStatus(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
