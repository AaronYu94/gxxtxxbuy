import { Router } from "express";
import { optionalUser, requireAdmin, requireFeature, requirePermission, requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createCreatorRouter({ authService, creatorService, env }) {
  const router = Router();
  const anyUser = optionalUser(authService);
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const creatorManage = requirePermission("ops:policy:write");
  const creatorsEnabled = requireFeature(env, "creators");

  router.post("/creator-campaign/touch", anyUser, creatorsEnabled, async (req, res, next) => {
    try {
      const result = await creatorService.recordTouch(req.body, { userId: req.user?.id || null }, requestMeta(req));
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/creator/dashboard", userAuth, creatorsEnabled, async (req, res, next) => {
    try {
      res.json(await creatorService.getDashboard(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/creators", adminAuth, creatorManage, async (req, res, next) => {
    try {
      res.status(201).json(await creatorService.createCreator(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/creators/:id/campaigns", adminAuth, creatorManage, async (req, res, next) => {
    try {
      res.status(201).json(await creatorService.createCampaign(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
