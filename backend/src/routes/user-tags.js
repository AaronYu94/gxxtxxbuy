import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-09-04 — user tags & groups (ops).
export function createUserTagRouter({ authService, userTagService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const usersSearch = requirePermission("users:search");

  router.post("/admin/user-tags", adminAuth, usersSearch, async (req, res, next) => {
    try { res.status(201).json(await userTagService.createTag(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/user-tags", adminAuth, usersSearch, async (_req, res, next) => {
    try { res.json(await userTagService.listTags()); } catch (error) { next(error); }
  });
  router.post("/admin/user-tags/assign", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.assignTag(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/user-tags/unassign", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.unassignTag(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  router.post("/admin/user-groups", adminAuth, usersSearch, async (req, res, next) => {
    try { res.status(201).json(await userTagService.createGroup(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/user-groups", adminAuth, usersSearch, async (_req, res, next) => {
    try { res.json(await userTagService.listGroups()); } catch (error) { next(error); }
  });
  router.patch("/admin/user-groups/:id/rule", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.updateGroupRule(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/user-groups/:id/members", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.addStaticMember(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.delete("/admin/user-groups/:id/members", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.removeMember(req.adminUser, req.params.id, req.body)); } catch (error) { next(error); }
  });
  router.get("/admin/user-groups/:id/members", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.listMembers(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/user-groups/:id/recompute", adminAuth, usersSearch, async (req, res, next) => {
    try { res.json(await userTagService.recomputeGroup(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
