import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-09-01/02/03 — restricted user search, role-tailored detail, CS-assisted edit.
export function createUserAdminRouter({ authService, userAdminService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const usersSearch = requirePermission("users:search");

  router.get("/admin/users/search", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userAdminService.search(req.adminUser, req.adminRoles, req.query, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/users/:id", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userAdminService.getDetail(req.adminUser, req.adminRoles, req.params.id, req.query, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/users/:id/assist-edit", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userAdminService.assistEdit(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
