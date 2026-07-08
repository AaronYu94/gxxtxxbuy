import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createClientCoreRouter({ authService, coreService }) {
  const router = Router();
  const userAuth = requireUser(authService);

  router.post("/links", userAuth, async (req, res, next) => {
    try {
      const result = await coreService.saveLink(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/links", userAuth, async (req, res, next) => {
    try {
      res.json(await coreService.listLinks(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/links/:id/parse", userAuth, async (req, res, next) => {
    try {
      res.status(202).json(await coreService.parseLink(req.user, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/links/:id", userAuth, async (req, res, next) => {
    try {
      res.json(await coreService.updateLink(req.user, req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/links/:id/add-to-haul", userAuth, async (req, res, next) => {
    try {
      const result = await coreService.addLinkToHaul(req.user, req.params.id, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/haul-items", userAuth, async (req, res, next) => {
    try {
      res.json(await coreService.listHaulItems(req.user, req.query.status || ""));
    } catch (error) {
      next(error);
    }
  });

  router.post("/purchase-orders", userAuth, async (req, res, next) => {
    try {
      const result = await coreService.submitPurchaseOrder(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders", userAuth, async (req, res, next) => {
    try {
      res.json(await coreService.listOrders(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/:id", userAuth, async (req, res, next) => {
    try {
      res.json(await coreService.getOrder(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/policies", async (_req, res, next) => {
    try {
      res.json(await coreService.listPolicies());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
