import express from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-12-02 — dead-letter view + permissioned replay.
export function createJobRouter({ authService, jobService }) {
  const router = express.Router();
  const adminAuth = requireAdmin(authService);
  const systemWrite = requirePermission("config:write");

  router.get("/admin/jobs/dead-letters", adminAuth, systemWrite, async (req, res, next) => {
    try { res.json(await jobService.listDeadLetters(req.query)); } catch (error) { next(error); }
  });
  router.post("/admin/jobs/dead-letters/:id/replay", adminAuth, systemWrite, async (req, res, next) => {
    try { res.json(await jobService.replay(req.adminUser, req.adminRoles, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/jobs/health", adminAuth, systemWrite, async (_req, res, next) => {
    try { res.json(await jobService.healthSignal()); } catch (error) { next(error); }
  });

  return router;
}
