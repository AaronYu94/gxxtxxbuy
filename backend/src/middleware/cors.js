export function corsMiddleware({ allowedOrigins = [] } = {}) {
  const allowed = new Set(allowedOrigins);
  const allowAny = allowed.has("*");

  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && (allowAny || allowed.has(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "content-type,authorization,x-request-id,x-device-id,if-match,idempotency-key,x-reauth-token"
      );
      res.setHeader("access-control-max-age", "600");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
