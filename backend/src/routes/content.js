import { Router } from "express";
import { requireAdmin, requirePermission, requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createContentRouter({ authService, contentService }) {
  const router = Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const reviewWrite = requirePermission("content:review:write");

  router.post("/haul-stories", userAuth, async (req, res, next) => {
    try {
      res.status(201).json(await contentService.createStory(req.user, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/haul-stories", userAuth, async (req, res, next) => {
    try {
      res.json(await contentService.listMyStories(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/haul-stories/:id/withdraw", userAuth, async (req, res, next) => {
    try {
      const result = await contentService.withdrawStory(req.user, req.params.id, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/content-review", adminAuth, reviewWrite, async (req, res, next) => {
    try {
      res.json(await contentService.listReviewQueue(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/content-review/:id/action", adminAuth, reviewWrite, async (req, res, next) => {
    try {
      res.json(await contentService.reviewStory(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
