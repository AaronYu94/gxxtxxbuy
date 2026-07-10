export class AppError extends Error {
  constructor(statusCode, code, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export function badRequest(message = "Bad request.", details) {
  return new AppError(400, "BAD_REQUEST", message, { details });
}

export function unauthorized(message = "Authentication required.") {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Permission denied.") {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Resource not found.") {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message = "Resource conflict.", details) {
  return new AppError(409, "CONFLICT", message, { details });
}

export function tooManyRequests(message = "Too many requests.", details) {
  return new AppError(429, "RATE_LIMITED", message, { details });
}

export function serviceUnavailable(message = "Service unavailable.", details) {
  return new AppError(503, "SERVICE_UNAVAILABLE", message, { details, expose: true });
}
