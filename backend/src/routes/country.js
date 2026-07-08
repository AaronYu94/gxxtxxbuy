import { Router } from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createCountryRouter({ authService, countryService }) {
  const router = Router();
  const adminAuth = requireAdmin(authService);
  const policyWrite = requirePermission("ops:policy:write");

  // Public: no auth required.
  router.get("/country-shipping/:country", async (req, res, next) => {
    try {
      res.json(await countryService.getPublishedCountry(req.params.country));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/country-shipping", adminAuth, policyWrite, async (req, res, next) => {
    try {
      res.json(await countryService.listRules(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/country-shipping", adminAuth, policyWrite, async (req, res, next) => {
    try {
      res.json(await countryService.upsertRule(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
