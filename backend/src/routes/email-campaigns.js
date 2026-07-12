import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-10-08/09/10 — promotional email campaigns.
export function createEmailCampaignRouter({ authService, emailCampaignService, env = {} }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const campaignWrite = requirePermission("campaign:write");
  const campaignRead = requirePermission("campaign:read");

  router.post("/admin/email-campaigns", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.status(201).json(await emailCampaignService.createCampaign(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/email-campaigns", adminAuth, campaignRead, async (_req, res, next) => {
    try { res.json(await emailCampaignService.listCampaigns()); } catch (error) { next(error); }
  });
  router.post("/admin/email-campaigns/:id/schedule", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await emailCampaignService.scheduleCampaign(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/email-campaigns/:id/batches", adminAuth, campaignRead, async (req, res, next) => {
    try { res.json(await emailCampaignService.listBatches(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/email-campaigns/batches/:batchId/send", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await emailCampaignService.sendBatch(req.adminUser, req.adminRoles, req.params.batchId, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/email-campaigns/:id/pause", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await emailCampaignService.pauseCampaign(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/email-campaigns/:id/resume", adminAuth, campaignWrite, async (req, res, next) => {
    try { res.json(await emailCampaignService.resumeCampaign(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/email-campaigns/:id/stats", adminAuth, campaignRead, async (req, res, next) => {
    try { res.json(await emailCampaignService.getStats(req.params.id)); } catch (error) { next(error); }
  });

  // Provider delivery webhook (verified upstream; idempotent by external id).
  router.post("/api/v2/email-events", async (req, res, next) => {
    try {
      if (env.emailWebhookSecret && req.get("x-email-signature") !== env.emailWebhookSecret) return res.status(401).json({ error: "invalid signature" });
      res.json(await emailCampaignService.recordEvent(req.body, requestMeta(req)));
    } catch (error) { next(error); }
  });
  // Public unsubscribe.
  router.post("/api/v2/email-unsubscribe", async (req, res, next) => {
    try { res.json(await emailCampaignService.unsubscribe(req.body)); } catch (error) { next(error); }
  });

  return router;
}
