export const PERMISSIONS = Object.freeze([
  ["*", "Full administrative access."],
  ["admin:read", "Read admin account metadata."],
  ["admin:manage", "Manage admin employees and roles."],
  ["audit:read", "Read immutable audit logs."],
  ["orders:read", "Read purchase orders."],
  ["orders:write", "Update purchase orders."],
  ["orders:controlled_transition", "Perform controlled order transitions."],
  ["procurement:read", "Read procurement work."],
  ["procurement:write", "Update assigned procurement work."],
  ["procurement:reassign", "Reassign procurement work in the organization."],
  ["warehouse:read", "Read warehouse queues."],
  ["warehouse:write", "Update warehouse and QC records."],
  ["warehouse:correct", "Perform controlled warehouse corrections."],
  ["support:read", "Read customer support context."],
  ["support:write", "Update support cases and notes."],
  ["users:search", "Search users by exact identifiers."],
  ["finance:wallet:write", "Post approved wallet entries."],
  ["finance:read", "Read finance records."],
  ["finance:write", "Update finance workflows."],
  ["finance:adjust", "Request or approve controlled adjustments."],
  ["finance:lock", "Apply finance safety locks."],
  ["campaign:read", "Read campaigns and operational content."],
  ["campaign:write", "Manage campaigns and operational content."],
  ["referral:read", "Read referral operations."],
  ["referral:write", "Manage referral operations."],
  ["ops:policy:write", "Update policy CMS and operational content."],
  ["content:review:write", "Review user-generated content."],
  ["risk:case:write", "Create and update risk cases."],
  ["shipping:read", "Read parcel and shipping operations."],
  ["shipping:write", "Update parcel and shipping operations."],
  ["config:read", "Read versioned configuration."],
  ["config:write", "Manage versioned configuration."],
  ["export:write", "Create sensitive exports."]
]);

export const ROLE_DEFINITIONS = Object.freeze([
  role("super_admin", "Super Admin", ["*"]),
  role("procurement_agent", "Procurement Agent", ["orders:read", "orders:write", "procurement:read", "procurement:write"]),
  role("procurement_lead", "Procurement Lead", ["orders:read", "orders:write", "orders:controlled_transition", "procurement:read", "procurement:write", "procurement:reassign"]),
  role("support_agent", "Support Agent", ["orders:read", "support:read", "support:write", "users:search"]),
  role("warehouse_operator", "Warehouse Operator", ["warehouse:read", "warehouse:write", "shipping:read", "shipping:write"]),
  role("warehouse_lead", "Warehouse Lead", ["warehouse:read", "warehouse:write", "warehouse:correct", "shipping:read", "shipping:write"]),
  role("finance_operator", "Finance Operator", ["finance:wallet:write", "finance:read", "finance:write", "finance:adjust", "finance:lock", "audit:read"]),
  role("campaign_operator", "Campaign Operator", ["campaign:read", "campaign:write", "ops:policy:write", "users:search"]),
  role("referral_operator", "Referral Operator", ["referral:read", "referral:write", "users:search"])
]);

export function hasPermission(permissions = [], requiredPermission) {
  return permissions.includes("*") || permissions.includes(requiredPermission);
}

function role(code, name, permissions) {
  return Object.freeze({
    code,
    name,
    description: `${name} V2 system role.`,
    permissions: Object.freeze(permissions)
  });
}
