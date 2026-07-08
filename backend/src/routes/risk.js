import { Router } from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createRiskRouter({ authService, riskService }) {
  const router = Router();
  const adminAuth = requireAdmin(authService);
  const riskWrite = requirePermission("risk:case:write");

  router.get("/admin/risk-cases", adminAuth, riskWrite, async (req, res, next) => {
    try {
      res.json(await riskService.listCases(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/risk-cases", adminAuth, riskWrite, async (req, res, next) => {
    try {
      res.status(201).json(await riskService.createCase(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/risk-cases/:id", adminAuth, riskWrite, async (req, res, next) => {
    try {
      res.json(await riskService.updateCase(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
