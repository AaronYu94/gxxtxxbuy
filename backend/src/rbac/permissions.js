export const PERMISSIONS = Object.freeze([
  ["*", "Administrator wildcard permission."],
  ["admin:read", "Read admin console metadata."],
  ["admin:manage", "Manage admin users and roles."],
  ["audit:read", "Read audit logs."],
  ["orders:read", "Read purchase orders."],
  ["orders:write", "Update purchase orders."],
  ["warehouse:read", "Read warehouse queues."],
  ["warehouse:write", "Update warehouse and QC records."],
  ["support:read", "Read customer support context."],
  ["support:write", "Update support cases and customer notes."],
  ["ops:policy:write", "Update policy CMS and operational content."],
  ["content:review:write", "Review and moderate user-generated content."],
  ["finance:wallet:write", "Adjust wallet credit and financial records."],
  ["risk:case:write", "Create and update risk cases."],
  ["shipping:read", "Read parcel and shipping operations."],
  ["shipping:write", "Update parcel and shipping operations."]
]);

export const ROLE_DEFINITIONS = Object.freeze([
  {
    code: "procurement",
    name: "Procurement",
    description: "Can review and update purchase orders.",
    permissions: ["orders:read", "orders:write"]
  },
  {
    code: "warehouse",
    name: "Warehouse",
    description: "Can receive warehouse items and upload QC.",
    permissions: ["warehouse:read", "warehouse:write"]
  },
  {
    code: "support",
    name: "Support",
    description: "Can read customer context and handle support cases.",
    permissions: ["orders:read", "support:read", "support:write", "content:review:write"]
  },
  {
    code: "operations",
    name: "Operations",
    description: "Can manage policy CMS and shipping operations.",
    permissions: ["ops:policy:write", "shipping:read", "shipping:write", "content:review:write"]
  },
  {
    code: "finance",
    name: "Finance",
    description: "Can adjust wallet and financial records.",
    permissions: ["finance:wallet:write", "audit:read"]
  },
  {
    code: "risk",
    name: "Risk",
    description: "Can manage risk cases and review suspicious activity.",
    permissions: ["risk:case:write", "content:review:write", "audit:read"]
  },
  {
    code: "administrator",
    name: "Administrator",
    description: "Full administrative access.",
    permissions: ["*"]
  }
]);

export function hasPermission(permissions = [], requiredPermission) {
  return permissions.includes("*") || permissions.includes(requiredPermission);
}
