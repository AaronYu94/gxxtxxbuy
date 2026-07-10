import { badRequest, forbidden } from "../errors/app-error.js";

export const DATA_SCOPES = Object.freeze({
  SELF: "SELF",
  ORG: "ORG",
  ASSIGNED: "ASSIGNED",
  SEARCH: "SEARCH",
  RELATED: "RELATED",
  ALL: "ALL"
});

export const ROLE_DATA_SCOPES = Object.freeze({
  super_admin: Object.freeze({ default: DATA_SCOPES.ALL }),
  procurement_agent: Object.freeze({ default: DATA_SCOPES.ASSIGNED, procurement: DATA_SCOPES.SELF }),
  procurement_lead: Object.freeze({ default: DATA_SCOPES.ORG, procurement: DATA_SCOPES.ORG }),
  support_agent: Object.freeze({ default: DATA_SCOPES.SEARCH }),
  warehouse_operator: Object.freeze({ default: DATA_SCOPES.ASSIGNED, warehouse: DATA_SCOPES.ASSIGNED }),
  warehouse_lead: Object.freeze({ default: DATA_SCOPES.ORG, warehouse: DATA_SCOPES.ORG }),
  finance_operator: Object.freeze({ default: DATA_SCOPES.RELATED, finance: DATA_SCOPES.RELATED }),
  campaign_operator: Object.freeze({ default: DATA_SCOPES.SEARCH, campaign: DATA_SCOPES.RELATED }),
  referral_operator: Object.freeze({ default: DATA_SCOPES.SEARCH, referral: DATA_SCOPES.RELATED })
});

const DEFAULT_EXACT_SEARCH_KEYS = Object.freeze(["id", "user_id", "order_no", "parcel_no", "email"]);

export function resolveDataScope(roles = [], domain = "default") {
  if (roles.length !== 1) {
    throw forbidden("Exactly one admin role is required.");
  }
  const definition = ROLE_DATA_SCOPES[roles[0]];
  if (!definition) throw forbidden("Admin role has no data-scope policy.");
  return definition[domain] || definition.default;
}

export function createDataScopeContext({ roles, adminUser, domain = "default", query = {}, exactSearchKeys = DEFAULT_EXACT_SEARCH_KEYS }) {
  const scope = resolveDataScope(roles, domain);
  const exactSearch = Object.fromEntries(
    exactSearchKeys
      .filter((key) => String(query[key] || "").trim())
      .map((key) => [key, String(query[key]).trim()])
  );
  if (scope === DATA_SCOPES.SEARCH && Object.keys(exactSearch).length === 0) {
    throw badRequest("An exact search criterion is required for this role.", { allowed: exactSearchKeys });
  }
  return Object.freeze({
    scope,
    adminUserId: adminUser?.id || null,
    organizationCode: adminUser?.organization_code || adminUser?.organizationCode || null,
    exactSearch
  });
}

export function requireDataScope(domain, options = {}) {
  return (req, _res, next) => {
    try {
      req.adminDataScope = createDataScopeContext({
        roles: req.adminRoles || [],
        adminUser: req.adminUser,
        domain,
        query: req.query || {},
        exactSearchKeys: options.exactSearchKeys
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function assertScopeCannotExpand(context, requested = {}) {
  if (context.scope === DATA_SCOPES.ALL) return;
  if (requested.admin_user_id && requested.admin_user_id !== context.adminUserId) {
    throw forbidden("Query cannot expand beyond the authenticated data scope.");
  }
  if (requested.organization_code && requested.organization_code !== context.organizationCode) {
    throw forbidden("Query cannot expand beyond the authenticated data scope.");
  }
}
