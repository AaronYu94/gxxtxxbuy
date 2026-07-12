// V2-09-04 — dynamic group rule evaluation (pure). A rule is a conjunction of
// simple, auditable predicates over a user's own attributes and tags:
//
//   { all: [ { field: "status", eq: "normal" },
//            { field: "country_code", eq: "US" },
//            { field: "tag", has: "vip" } ] }
//
// Only these fields are supported (no free-form SQL, no PII beyond membership).
// Evaluation is deterministic, so a recompute is idempotent for a fixed input set.
export function matchesRule(user, rule) {
  if (!rule || typeof rule !== "object") return false;
  const clauses = Array.isArray(rule.all) ? rule.all : [];
  if (clauses.length === 0) return false; // an empty rule never matches everyone
  return clauses.every((c) => matchesClause(user, c));
}

function matchesClause(user, clause) {
  if (!clause || typeof clause !== "object") return false;
  const tags = Array.isArray(user.tags) ? user.tags : [];
  switch (clause.field) {
    case "status": return user.status === clause.eq;
    case "country_code": return (user.countryCode || user.country_code || "") === clause.eq;
    case "tag": return tags.includes(clause.has);
    default: return false;
  }
}

// Validate a rule shape before it is stored (rejects unknown fields / empty).
export function validateRule(rule) {
  if (!rule || typeof rule !== "object" || !Array.isArray(rule.all) || rule.all.length === 0) {
    return { ok: false, reason: "rule must have a non-empty `all` array" };
  }
  const allowed = new Set(["status", "country_code", "tag"]);
  for (const c of rule.all) {
    if (!c || !allowed.has(c.field)) return { ok: false, reason: `unsupported field: ${c && c.field}` };
    if (c.field === "tag" ? typeof c.has !== "string" : typeof c.eq !== "string") {
      return { ok: false, reason: `clause for ${c.field} is malformed` };
    }
  }
  return { ok: true };
}
