import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-08 — after-sales (returns & refunds). User + procurement review + material.
export function createAfterSalesRouter({ authService, afterSalesService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const procurementWrite = requirePermission("procurement:write");
  const procurementRead = requireAnyPermission(["procurement:read", "procurement:write"]);
  const warehouseWrite = requirePermission("warehouse:write");
  const financeWrite = requireAnyPermission(["finance:wallet:write", "finance:write"]);

  router.get("/api/v2/after-sales/items/:itemId/eligibility", userAuth, async (req, res, next) => {
    try { res.json(await afterSalesService.checkEligibility(req.user, req.params.itemId)); } catch (error) { next(error); }
  });
  router.post("/api/v2/after-sales/items/:itemId/return", userAuth, async (req, res, next) => {
    try { res.status(201).json(await afterSalesService.requestReturn(req.user, req.params.itemId, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/api/v2/after-sales", userAuth, async (req, res, next) => {
    try { res.json(await afterSalesService.listMyAfterSales(req.user)); } catch (error) { next(error); }
  });
  router.post("/api/v2/after-sales/:id/material", userAuth, async (req, res, next) => {
    try { res.json(await afterSalesService.supplementMaterial(req.user, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/api/v2/after-sales/:id/return-fee/pay", userAuth, async (req, res, next) => {
    try { res.json(await afterSalesService.payReturnFee(req.user, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/api/v2/after-sales/:id", userAuth, async (req, res, next) => {
    try { res.json(await afterSalesService.getAfterSales(req.user, req.params.id)); } catch (error) { next(error); }
  });

  // ---- V2-08-04 procurement review (customer service lacks procurement:write) ----
  router.get("/admin/after-sales", adminAuth, procurementRead, async (req, res, next) => {
    try { res.json(await afterSalesService.listForStaff(req.query)); } catch (error) { next(error); }
  });
  router.get("/admin/after-sales/:id", adminAuth, procurementRead, async (req, res, next) => {
    try { res.json(await afterSalesService.adminGetAfterSales(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/review/start", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.startReview(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/review/approve", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.approveReview(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/review/reject", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.rejectReview(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/review/request-material", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.requestMaterial(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/close", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.closeStalled(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // ---- V2-08-07/08/09 warehouse return handling ----
  router.post("/admin/after-sales/:id/return-pick/scan", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.scanReturnPick(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/return-verify", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.verifyReturn(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/return-pack", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.packReturn(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/ship-back", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.shipBackToMerchant(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/shipment-event", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.recordShipmentEvent(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/exception", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.raiseException(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/exception/resolve", adminAuth, warehouseWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.resolveException(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // ---- V2-08-10 merchant refund (procurement) ----
  router.post("/admin/after-sales/:id/merchant-received", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.markMerchantReceived(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/merchant-refund", adminAuth, procurementWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.registerMerchantRefund(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // ---- V2-08-11/12 platform refund accounting + finance wallet refund ----
  router.get("/admin/after-sales/:id/refund-preview", adminAuth, procurementRead, async (req, res, next) => {
    try { res.json(await afterSalesService.previewRefund(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/after-sales/:id/refund/execute", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await afterSalesService.executeRefund(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
