import { Router } from "express";
import { requireAdmin, requireHighRiskReauth, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createAdminSecurityRouter({ authService }) {
  const router = Router();
  const adminOnly = [requireAdmin(authService), requirePermission("admin:manage")];

  router.post(
    "/admin/security/users/:adminUserId/disable",
    ...adminOnly,
    requireHighRiskReauth(authService, "admin.user.disable"),
    async (req, res, next) => {
      try {
        res.json({ admin_user: await authService.disableAdmin(req.auth, req.params.adminUserId, requestMeta(req)) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/admin/security/users/:adminUserId/role",
    ...adminOnly,
    requireHighRiskReauth(authService, "admin.role.assign"),
    async (req, res, next) => {
      try {
        res.status(201).json(await authService.assignAdminRole(
          req.auth, req.params.adminUserId, String(req.body?.role_code || "").trim(), requestMeta(req)
        ));
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
