import express from "express";
import { optionalUser, requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-10-07/11 — email templates + config version center.
export function createCmsRouter({ authService, cmsService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const campaignWrite = requirePermission("campaign:write");
  const campaignRead = requirePermission("campaign:read");
  const policyWrite = requirePermission("ops:policy:write");

  router.post("/admin/email-templates", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.status(201).json(await cmsService.createTemplate(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/email-templates", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(await cmsService.listTemplates()); } catch (error) { next(error); }
  });
  router.post("/admin/email-templates/:id/publish", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await cmsService.publishTemplate(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });

  // Config version center (super-admin write via service; policy:write route gate).
  router.post("/admin/config-docs", adminAuth, policyWrite, async (req, res, next) => {
    try { res.status(201).json(await cmsService.publishConfigDoc(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/config-docs/:kind/:docKey/versions", adminAuth, campaignRead, async (req, res, next) => {
    try { res.json(await cmsService.listConfigDocVersions(req.params.kind, req.params.docKey)); } catch (error) { next(error); }
  });
  router.get("/admin/config-docs/:kind/:docKey/versions/:version", adminAuth, campaignRead, async (req, res, next) => {
    try { res.json(await cmsService.getConfigDocVersion(req.params.kind, req.params.docKey, req.query.language || "en", req.params.version)); } catch (error) { next(error); }
  });

  // Public read of the active config document (agreements / announcements).
  router.get("/api/v2/config-docs/:kind/:docKey", optionalUser(authService), async (req, res, next) => {
    try { res.json(await cmsService.getConfigDoc(req.params.kind, req.params.docKey, req.query.language || "en")); } catch (error) { next(error); }
  });

  return router;
}
