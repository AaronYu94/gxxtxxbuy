import express from "express";
import { requireUser, requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-10-01/02/03/04 — international-shipping coupons.
export function createCouponRouter({ authService, couponService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const campaignWrite = requirePermission("campaign:write");
  const campaignRead = requirePermission("campaign:read");

  router.post("/admin/promo-coupons", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.status(201).json(await couponService.createCoupon(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/promo-coupons", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(await couponService.listCoupons()); } catch (error) { next(error); }
  });
  router.patch("/admin/promo-coupons/:id", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await couponService.updateCoupon(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/promo-coupons/:id/publish", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await couponService.publishCoupon(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/promo-coupons/:id/disable", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await couponService.disableCoupon(req.adminUser, req.adminRoles, req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/promo-coupons/grant", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.status(201).json(await couponService.grant(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // User-facing.
  router.get("/api/v2/promo-coupons", userAuth, async (req, res, next) => {
    try { res.json(await couponService.listMyCoupons(req.user)); } catch (error) { next(error); }
  });
  router.post("/api/v2/promo-coupons/redeem", userAuth, async (req, res, next) => {
    try { res.status(201).json(await couponService.redeemCode(req.user, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/api/v2/promo-coupons/eligible", userAuth, async (req, res, next) => {
    try { res.json(await couponService.listEligible(req.user, req.query)); } catch (error) { next(error); }
  });

  return router;
}
