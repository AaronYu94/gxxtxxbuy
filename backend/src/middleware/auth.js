import { forbidden, serviceUnavailable, unauthorized } from "../errors/app-error.js";
import { hasPermission } from "../rbac/permissions.js";

export function requireUser(authService) {
  return async (req, _res, next) => {
    try {
      const auth = await authService.authenticateUser(getBearerToken(req));
      req.auth = auth;
      req.user = auth.user;
      req.session = auth.session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function optionalUser(authService) {
  return async (req, _res, next) => {
    const header = req.get("authorization") || "";
    if (!header.trim()) {
      next();
      return;
    }
    try {
      const auth = await authService.authenticateUser(getBearerToken(req));
      req.auth = auth;
      req.user = auth.user;
      req.session = auth.session;
    } catch {
      // Anonymous visitors and stale tokens are still allowed through with no user.
    }
    next();
  };
}

export function requireAdmin(authService) {
  return async (req, _res, next) => {
    try {
      const auth = await authService.authenticateAdmin(getBearerToken(req));
      req.auth = auth;
      req.adminUser = auth.adminUser;
      req.adminPermissions = auth.permissions;
      req.adminRoles = auth.roles;
      req.session = auth.session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(requiredPermission) {
  return (req, _res, next) => {
    try {
      if (!req.adminUser) {
        throw unauthorized("Admin authentication required.");
      }

      if (!hasPermission(req.adminPermissions || [], requiredPermission)) {
        throw forbidden("Permission denied.");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAnyPermission(requiredPermissions = []) {
  return (req, _res, next) => {
    try {
      if (!req.adminUser) {
        throw unauthorized("Admin authentication required.");
      }

      if (!requiredPermissions.some((permission) => hasPermission(req.adminPermissions || [], permission))) {
        throw forbidden("Permission denied.");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// B8-07: canary/kill switch. When a feature flag is off, the guarded route returns a
// clear 503 with FEATURE_DISABLED so operators can shut a surface (payments, shipping,
// coupons, creators) without a deploy.
export function requireFeature(env, featureName) {
  return (_req, _res, next) => {
    if (env?.features?.[featureName] === false) {
      next(serviceUnavailable(`The ${featureName} feature is temporarily disabled.`, { code: "FEATURE_DISABLED", feature: featureName }));
      return;
    }
    next();
  };
}

export function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw unauthorized("Bearer token is required.");
  }
  return token.trim();
}
