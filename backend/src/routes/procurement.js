import express from "express";
import { requireAdmin, requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { requireDataScope } from "../rbac/data-scope.js";
import { requestMeta } from "./auth.js";

// V2-04-04/07/08/09 — procurement account management + task workbench (admin).
// Gated on the V2 procurement permissions seeded in migration 000014.
export function createProcurementRouter({ authService, procurementService, orderService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const accountRead = requireAnyPermission(["procurement:read", "procurement:write"]);
  const accountWrite = requirePermission("procurement:write");
  const reassignWrite = requirePermission("procurement:reassign");
  const correctionWrite = requirePermission("orders:controlled_transition");

  router.post("/admin/procurement/accounts", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.status(201).json(await procurementService.createAccount(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/procurement/accounts", adminAuth, accountRead, async (req, res, next) => {
    try {
      res.json(await procurementService.listAccounts(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/procurement/accounts/:id", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.json(await procurementService.updateAccount(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // Procurement task workbench (V2-04-07/08/09).
  router.get("/admin/procurement/tasks", adminAuth, accountRead, requireDataScope("procurement", { exactSearchKeys: ["item_no"] }), async (req, res, next) => {
    try {
      res.json(await procurementService.listTasks(req.adminDataScope, req.query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/procurement/tasks/:id", adminAuth, accountRead, async (req, res, next) => {
    try {
      res.json(await procurementService.getTaskDetail(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/procurement/tasks/:id/claim", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.json(await procurementService.claimTask(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/procurement/tasks/:id/confirm", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.status(201).json(await procurementService.confirmPurchase(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // Buyer raises a procurement exception (V2-04-10 price increase / V2-04-11 availability).
  router.post("/admin/procurement/tasks/:id/price-increase", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.status(201).json(await orderService.raisePriceIncrease(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/procurement/tasks/:id/availability", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.status(201).json(await orderService.raiseAvailability(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-04-14 merchant dispatch registration + correction.
  router.post("/admin/procurement/tasks/:id/dispatch", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.status(201).json(await orderService.registerDispatch(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/procurement/tasks/:id/dispatch", adminAuth, accountWrite, async (req, res, next) => {
    try {
      res.json(await orderService.correctDispatch(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-04-15 lead reassignment (procurement:reassign) + controlled correction
  // (orders:controlled_transition; terminal targets require the super_admin role).
  router.post("/admin/procurement/tasks/:id/reassign", adminAuth, reassignWrite, async (req, res, next) => {
    try {
      res.json(await orderService.reassignItem(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/procurement/tasks/:id/correct", adminAuth, correctionWrite, async (req, res, next) => {
    try {
      res.json(await orderService.controlledCorrection(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
