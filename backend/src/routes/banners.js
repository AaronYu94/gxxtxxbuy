import express from "express";
import { optionalUser, requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-10-05/06 — homepage carousel banners (campaign ops + public read).
export function createBannerRouter({ authService, bannerService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const campaignWrite = requirePermission("campaign:write");
  const campaignRead = requirePermission("campaign:read");

  router.post("/admin/banners", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.status(201).json(await bannerService.createBanner(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/banners", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(await bannerService.listBanners()); } catch (error) { next(error); }
  });
  router.patch("/admin/banners/:id", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await bannerService.updateBanner(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/banners/:id/preview", adminAuth, campaignRead, async (req, res, next) => {
    try { res.json(await bannerService.previewBanner(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/banners/:id/publish", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await bannerService.publishBanner(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/banners/:id/unpublish", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await bannerService.unpublishBanner(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });

  // Public homepage read (no auth required; optional user for personalization).
  router.get("/api/v2/banners", optionalUser(authService), async (req, res, next) => {
    try { res.json(await bannerService.listForClient(req.query)); } catch (error) { next(error); }
  });

  return router;
}
