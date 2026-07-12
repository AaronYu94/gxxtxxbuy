import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-11-02/04 — referral code / link / QR (user) + tier config (super-admin).
export function createReferralRouter({ authService, referralService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const referralRead = requireAnyPermission(["referral:read", "referral:write"]);
  const configWrite = requirePermission("config:write");

  router.get("/api/v2/referral/code", userAuth, async (req, res, next) => {
    try { res.json(await referralService.getMyCode(req.user)); } catch (error) { next(error); }
  });
  router.get("/api/v2/referral", userAuth, async (req, res, next) => {
    try { res.json(await referralService.getMyReferral(req.user)); } catch (error) { next(error); }
  });
  router.get("/api/v2/referral/level", userAuth, async (req, res, next) => {
    try { res.json(await referralService.getPromoterLevel(req.user.id)); } catch (error) { next(error); }
  });
  // Public code validity check (for the signup form).
  router.get("/api/v2/referral/lookup", async (req, res, next) => {
    try { res.json(await referralService.lookupCode(String(req.query.code || ""))); } catch (error) { next(error); }
  });

  // ---- V2-11-04 promotion tier config (super-admin) ----
  router.post("/admin/referral/tiers", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await referralService.publishTierConfig(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/referral/tiers", adminAuth, referralRead, async (_req, res, next) => {
    try { res.json(await referralService.getActiveTierConfig()); } catch (error) { next(error); }
  });
  router.get("/admin/referral/tiers/versions", adminAuth, referralRead, async (_req, res, next) => {
    try { res.json(await referralService.listTierConfigVersions()); } catch (error) { next(error); }
  });

  return router;
}
