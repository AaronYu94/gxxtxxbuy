import { Router } from "express";
import { serviceUnavailable } from "../errors/app-error.js";

export function createSystemRouter({ env, services }) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: env.serviceName,
      version: env.appVersion,
      uptime_s: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      request_id: req.requestId
    });
  });

  router.get("/ready", async (_req, res, next) => {
    try {
      const checks = await Promise.all([
        services.checkDatabase(),
        services.checkRedis()
      ]);
      const ready = checks.every((check) => check.ok);

      if (!ready) {
        throw serviceUnavailable("Service dependencies are not ready.", { checks });
      }

      res.json({
        status: "ready",
        checks
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/version", (_req, res) => {
    res.json({
      service: env.serviceName,
      version: env.appVersion,
      environment: env.nodeEnv,
      git_sha: process.env.GIT_SHA || "local"
    });
  });

  return router;
}
