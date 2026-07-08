const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "password_hash",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "payment",
  "card",
  "address"
]);

export function createAuditLogger({ repository, logger = console } = {}) {
  return {
    async write(event, options = {}) {
      return writeAuditLog({ repository, logger, event, ...options });
    }
  };
}

export async function writeAuditLog({ repository, logger = console, event, critical = true }) {
  if (!repository?.insertAuditLog) {
    if (critical) {
      throw new Error("Audit repository is not configured.");
    }
    return false;
  }

  const log = normalizeAuditEvent(event);
  try {
    await repository.insertAuditLog(log);
    return true;
  } catch (error) {
    logger.error?.(
      JSON.stringify({
        level: "error",
        event: "audit_write_failed",
        action: log.action,
        resource_type: log.resourceType,
        message: error.message
      })
    );
    if (critical) {
      throw error;
    }
    return false;
  }
}

export function normalizeAuditEvent(event = {}) {
  const actorType = event.actorType || event.actor_type || "system";
  return {
    actorType,
    actorUserId: event.actorUserId || event.actor_user_id || null,
    actorAdminUserId: event.actorAdminUserId || event.actor_admin_user_id || null,
    action: requireText(event.action, "action"),
    resourceType: requireText(event.resourceType || event.resource_type, "resourceType"),
    resourceId: event.resourceId || event.resource_id || null,
    metadata: redactMetadata(event.metadata || {}),
    requestId: event.requestId || event.request_id || null,
    ipHash: event.ipHash || event.ip_hash || null
  };
}

export function redactMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactMetadata(item));
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }
      return [key, redactMetadata(child)];
    })
  );
}

function requireText(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Audit ${field} is required.`);
  }
  return text;
}
