import { AppError, notFound } from "../errors/app-error.js";

export function notFoundHandler(req, _res, next) {
  next(notFound(`Route ${req.method} ${req.path} was not found.`));
}

export function errorHandler({ logger = console } = {}) {
  return (error, req, res, _next) => {
    const normalized = normalizeError(error);
    const requestId = req.requestId || req.get("x-request-id") || null;

    if (normalized.statusCode >= 500) {
      logger.error?.(
        JSON.stringify({
          level: "error",
          event: "request_error",
          request_id: requestId,
          code: normalized.code,
          message: normalized.message
        })
      );
    }

    res.status(normalized.statusCode).json({
      error: {
        code: normalized.code,
        message: normalized.expose ? normalized.message : "Internal server error.",
        request_id: requestId,
        ...(normalized.details ? { details: normalized.details } : {})
      }
    });
  };
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_JSON", "Request body contains invalid JSON.");
  }

  return new AppError(500, "INTERNAL_SERVER_ERROR", "Internal server error.", { cause: error });
}
