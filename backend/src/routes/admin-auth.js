import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createAdminAuthRouter({ authService }) {
  const router = Router();

  router.post("/admin/auth/login", async (req, res, next) => {
    try {
      res.json(await authService.loginAdmin(req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/auth/refresh", async (req, res, next) => {
    try {
      res.json(await authService.refreshAdminSession(req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/auth/logout", requireAdmin(authService), async (req, res, next) => {
    try {
      await authService.revokeSession(req.session.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/me", requireAdmin(authService), (req, res) => {
    res.json({
      admin_user: req.adminUser,
      roles: req.adminRoles,
      permissions: req.adminPermissions
    });
  });

  return router;
}
