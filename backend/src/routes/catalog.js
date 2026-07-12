import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-03-08 — link parse, snapshot, and payable-price API. Every handler is
// user-scoped through requireUser; the service enforces ownership on each record.
export function createCatalogRouter({ authService, catalogService }) {
  const router = Router();
  const userAuth = requireUser(authService);

  router.post("/api/v2/catalog/parse-jobs", userAuth, async (req, res, next) => {
    try {
      const result = await catalogService.submitParse(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/catalog/parse-jobs", userAuth, async (req, res, next) => {
    try {
      res.json(await catalogService.listParseJobs(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/catalog/parse-jobs/:id", userAuth, async (req, res, next) => {
    try {
      res.json(await catalogService.getParseJob(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/catalog/parse-jobs/:id/retry", userAuth, async (req, res, next) => {
    try {
      res.status(202).json(await catalogService.retryParse(req.user, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/catalog/parse-jobs/:id/manual-fill", userAuth, async (req, res, next) => {
    try {
      res.status(201).json(await catalogService.manualFill(req.user, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/catalog/snapshots/:id", userAuth, async (req, res, next) => {
    try {
      res.json(await catalogService.getSnapshot(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/catalog/price-calculations", userAuth, async (req, res, next) => {
    try {
      res.status(201).json(await catalogService.calculatePrice(req.user, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
