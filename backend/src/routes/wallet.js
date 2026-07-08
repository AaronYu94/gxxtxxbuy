import { Router } from "express";
import { requireAdmin, requireAnyPermission, requireFeature, requirePermission, requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createWalletRouter({ authService, walletService, env }) {
  const router = Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const couponWrite = requireAnyPermission(["ops:policy:write", "finance:wallet:write"]);
  const financeWrite = requirePermission("finance:wallet:write");
  const couponsEnabled = requireFeature(env, "coupons");

  router.get("/wallet", userAuth, async (req, res, next) => {
    try {
      res.json(await walletService.getWallet(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/coupons/redeem-code", userAuth, couponsEnabled, async (req, res, next) => {
    try {
      const result = await walletService.redeemCode(req.user, req.body, requestMeta(req));
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/welcome-gift/claim", userAuth, async (req, res, next) => {
    try {
      const result = await walletService.claimWelcomeGift(req.user, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/checkout/apply-coupon", userAuth, couponsEnabled, async (req, res, next) => {
    try {
      const result = await walletService.applyCoupon(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/coupons", adminAuth, couponWrite, async (req, res, next) => {
    try {
      res.status(201).json(await walletService.createAdminCoupon(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/wallets/:userId/credit", adminAuth, financeWrite, async (req, res, next) => {
    try {
      res.json(await walletService.adjustWalletCredit(req.adminUser, req.params.userId, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
