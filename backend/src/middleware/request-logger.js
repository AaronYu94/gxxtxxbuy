import { randomUUID } from "node:crypto";
import { redactHeaders } from "../utils/redact.js";

export function requestLogger({ logger = console, logLevel = "info" } = {}) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = normalizeRequestId(req.get("x-request-id")) || randomUUID();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      if (logLevel === "silent") {
        return;
      }

      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info?.(
        JSON.stringify({
          level: "info",
          event: "http_request",
          request_id: requestId,
          method: req.method,
          path: req.path,
          status_code: res.statusCode,
          latency_ms: Math.round(latencyMs * 100) / 100,
          headers: redactHeaders({
            "user-agent": req.get("user-agent"),
            "x-forwarded-for": req.get("x-forwarded-for")
          })
        })
      );
    });

    next();
  };
}

function normalizeRequestId(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();
  if (trimmed.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    return "";
  }

  return trimmed;
}
