import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-09-08/09/10 — account risk events, lock requests, approval (finance + super).
export function createAccountRiskRouter({ authService, accountRiskService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const financeLock = requirePermission("finance:lock");

  router.post("/admin/account-risk/events", adminAuth, financeLock, async (req, res, next) => {
    try { res.status(201).json(await accountRiskService.recordEvent(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/account-risk/users/:userId/events", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.listEvents(req.params.userId)); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/lock-requests", adminAuth, financeLock, async (req, res, next) => {
    try { res.status(201).json(await accountRiskService.requestLock(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/account-risk/lock-requests", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.listRequests(req.query)); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/lock-requests/:id/approve", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.approveLock(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/lock-requests/:id/reject", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.rejectLock(req.adminUser, req.adminRoles, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/unlock", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.unlock(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/account-risk/users/:userId/status", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.getAccountStatus(req.params.userId)); } catch (error) { next(error); }
  });

  // ---- V2-09-11 address blacklist ----
  router.post("/admin/account-risk/blacklist", adminAuth, financeLock, async (req, res, next) => {
    try { res.status(201).json(await accountRiskService.addBlacklistAddress(req.adminUser, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/account-risk/blacklist", adminAuth, financeLock, async (_req, res, next) => {
    try { res.json(await accountRiskService.listBlacklist()); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/blacklist/check", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.checkAddress(req.body)); } catch (error) { next(error); }
  });
  router.get("/admin/account-risk/review-flags", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.listReviewFlags(req.query)); } catch (error) { next(error); }
  });
  router.post("/admin/account-risk/review-flags/:id/decide", adminAuth, financeLock, async (req, res, next) => {
    try { res.json(await accountRiskService.decideReviewFlag(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  return router;
}
