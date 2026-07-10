import express from "express";
import { requireAdmin, requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { requireDataScope } from "../rbac/data-scope.js";
import { requestMeta } from "./auth.js";

export function createAdminConsoleRouter({ authService, adminService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const orderRead = requireAnyPermission(["orders:read", "orders:write", "support:read"]);
  const orderWrite = requirePermission("orders:write");
  const orderExceptionWrite = requireAnyPermission(["orders:write", "support:write"]);
  const warehouseRead = requireAnyPermission(["warehouse:read", "warehouse:write"]);
  const parcelRead = requireAnyPermission(["shipping:read", "shipping:write", "support:read"]);
  const policyWrite = requirePermission("ops:policy:write");

  router.get("/admin/overview", adminAuth, async (req, res, next) => {
    try {
      res.json(await adminService.getOverview(req.adminUser, req.adminPermissions));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/orders", adminAuth, orderRead, requireDataScope("orders"), async (req, res, next) => {
    try {
      res.json(await adminService.listOrders(req.query, req.adminDataScope, req.adminUser, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/orders/:id/status", adminAuth, orderWrite, async (req, res, next) => {
    try {
      res.json(await adminService.updateOrderStatus(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/orders/:id/exception", adminAuth, orderExceptionWrite, async (req, res, next) => {
    try {
      res.json(await adminService.updateOrderException(req.adminUser, req.adminPermissions, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/warehouse/items", adminAuth, warehouseRead, requireDataScope("warehouse"), async (req, res, next) => {
    try {
      res.json(await adminService.listWarehouseItems(req.query, req.adminDataScope, req.adminUser, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/parcels", adminAuth, parcelRead, requireDataScope("shipping"), async (req, res, next) => {
    try {
      res.json(await adminService.listParcels(req.adminPermissions, req.query, req.adminDataScope, req.adminUser, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/policies", adminAuth, policyWrite, async (req, res, next) => {
    try {
      res.json(await adminService.listPolicies(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/policies/:id", adminAuth, policyWrite, async (req, res, next) => {
    try {
      res.json(await adminService.updatePolicy(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
