import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-10-12..16 — customer support conversations.
export function createSupportRouter({ authService, supportService, env = {} }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const supportRead = requirePermission("support:read");
  const supportWrite = requirePermission("support:write");

  router.get("/admin/support/conversations", adminAuth, supportRead, async (req, res, next) => {
    try { res.json(await supportService.listConversations(req.query)); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations", adminAuth, supportWrite, async (req, res, next) => {
    try { res.status(201).json(await supportService.createConversation(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/support/conversations/:id", adminAuth, supportRead, async (req, res, next) => {
    try { res.json(await supportService.getConversation(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/claim", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.claim(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/transfer", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.transfer(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/reply", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.reply(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/resolve", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.resolve(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/reopen", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.reopen(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/support/conversations/:id/link-after-sales", adminAuth, supportWrite, async (req, res, next) => {
    try { res.json(await supportService.linkAfterSales(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // Inbound email/chat webhook (verified upstream; idempotent by external id).
  router.post("/api/v2/support/inbound", async (req, res, next) => {
    try {
      if (env.supportInboundSecret && req.get("x-inbound-signature") !== env.supportInboundSecret) return res.status(401).json({ error: "invalid signature" });
      res.json(await supportService.ingestInbound(req.body, requestMeta(req)));
    } catch (error) { next(error); }
  });

  return router;
}
