import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-04-03 — parent/child order API. Every handler is user-scoped through
// requireUser; the service enforces ownership on each record.
export function createOrderRouter({ authService, orderService }) {
  const router = Router();
  const userAuth = requireUser(authService);

  router.post("/api/v2/orders", userAuth, async (req, res, next) => {
    try {
      const result = await orderService.createOrder(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/orders", userAuth, async (req, res, next) => {
    try {
      res.json(await orderService.listOrders(req.user));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/orders/:id", userAuth, async (req, res, next) => {
    try {
      res.json(await orderService.getOrder(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  // V2-04-12 — user views and resolves a purchase exception on one item.
  router.get("/api/v2/orders/items/:id/exception", userAuth, async (req, res, next) => {
    try {
      res.json(await orderService.getItemException(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/orders/items/:id/exception/respond", userAuth, async (req, res, next) => {
    try {
      res.json(await orderService.respondException(req.user, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
