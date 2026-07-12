import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-09-05/06/07 — membership tier config (super-admin) + user membership center.
export function createMembershipRouter({ authService, membershipService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const configWrite = requirePermission("config:write");
  const configRead = requireAnyPermission(["config:read", "config:write"]);

  router.post("/admin/membership/config", adminAuth, configWrite, async (req, res, next) => {
    try { res.status(201).json(await membershipService.publishConfig(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/membership/config", adminAuth, configRead, async (_req, res, next) => {
    try { res.json(await membershipService.getActiveConfig()); } catch (error) { next(error); }
  });
  router.get("/admin/membership/config/versions", adminAuth, configRead, async (_req, res, next) => {
    try { res.json(await membershipService.listConfigVersions()); } catch (error) { next(error); }
  });

  // User membership center.
  router.get("/api/v2/membership", userAuth, async (req, res, next) => {
    try { res.json(await membershipService.getMembership(req.user)); } catch (error) { next(error); }
  });

  return router;
}
