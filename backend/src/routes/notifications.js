import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";

// V2-10-18 — notification + cron catalog and dead-letter view.
export function createNotificationRouter({ authService, notificationService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const campaignRead = requirePermission("campaign:read");

  router.get("/admin/notifications/catalog", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(notificationService.catalog()); } catch (error) { next(error); }
  });
  router.get("/admin/notifications/dead-letters", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(await notificationService.listDeadLetters()); } catch (error) { next(error); }
  });

  return router;
}
