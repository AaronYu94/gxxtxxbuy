import { Router } from "express";
import { requireUser } from "../middleware/auth.js";

export function createAuthRouter({ authService }) {
  const router = Router();

  router.post("/auth/register", async (req, res, next) => {
    try {
      const result = await authService.registerUser(req.body, requestMeta(req));
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      res.json(await authService.loginUser(req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/refresh", async (req, res, next) => {
    try {
      res.json(await authService.refreshUserSession(req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", requireUser(authService), async (req, res, next) => {
    try {
      await authService.revokeSession(req.session.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireUser(authService), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

export function requestMeta(req) {
  return {
    requestId: req.requestId,
    userAgent: req.get("user-agent") || "",
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}
