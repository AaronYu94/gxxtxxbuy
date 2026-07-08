import { Router } from "express";
import { requireAdmin, requireFeature, requirePermission, requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createShippingRouter({ authService, shippingService, env }) {
  const router = Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const shippingWrite = requirePermission("shipping:write");
  const shippingEnabled = requireFeature(env, "shipping");
  const paymentsEnabled = requireFeature(env, "payments");

  router.get("/shipping-lines", async (req, res, next) => {
    try {
      res.json(await shippingService.listShippingLines(req.query.country || ""));
    } catch (error) {
      next(error);
    }
  });

  router.get("/parcels", userAuth, async (req, res, next) => {
    try {
      res.json(await shippingService.listParcels(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/parcels/draft", userAuth, shippingEnabled, async (req, res, next) => {
    try {
      const result = await shippingService.createParcelDraft(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping/preview", userAuth, async (req, res, next) => {
    try {
      res.json(await shippingService.previewShipping(req.user, req.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/parcels", userAuth, shippingEnabled, async (req, res, next) => {
    try {
      const result = await shippingService.submitParcel(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping-payments", userAuth, paymentsEnabled, async (req, res, next) => {
    try {
      const result = await shippingService.createShippingPayment(req.user, {
        ...req.body,
        idempotency_key: req.body?.idempotency_key || req.get("idempotency-key") || ""
      }, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/webhooks/shipping-payments", async (req, res, next) => {
    try {
      const result = await shippingService.handlePaymentWebhook(req.body, req.get("x-goatedbuy-signature") || "");
      res.status(result.existing ? 200 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/parcels/:id/tracking", userAuth, async (req, res, next) => {
    try {
      res.json(await shippingService.getTracking(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/parcels/:id/status", adminAuth, shippingWrite, async (req, res, next) => {
    try {
      const result = await shippingService.updateAdminParcelStatus(req.adminUser, req.params.id, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
