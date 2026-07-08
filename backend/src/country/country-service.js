import { badRequest, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";

export function createCountryService({ repository, auditLogger = null, clock = () => new Date() } = {}) {
  if (!repository) throw new Error("Country repository is required.");

  return {
    // B7-14: public country shipping hub. Returns only published content and flags
    // when the published version has passed its expiry so stale rules are never
    // silently presented as current.
    async getPublishedCountry(countryParam) {
      const country = normalizeCountry(countryParam);
      const rule = await repository.findPublishedRule(country);
      if (!rule) throw notFound("Country shipping rules are not published yet.");
      const expired = Boolean(rule.expiresAt && new Date(rule.expiresAt).getTime() <= clock().getTime());
      return { country: publicCountryRule(rule), expired };
    },

    async upsertRule(adminUser, input = {}, requestMeta = {}) {
      const country = normalizeCountry(input.country);
      const status = normalizeStatus(input.status);
      const version = normalizeVersion(input.version);
      const rule = await repository.upsertRule({
        country,
        version,
        title: optionalText(input.title, "title", 160),
        summary: optionalText(input.summary, "summary", 500),
        content: normalizeContent(input.content),
        status,
        publishedAt: status === "published" ? (input.published_at || input.publishedAt || clock().toISOString()) : null,
        expiresAt: input.expires_at || input.expiresAt || null,
        createdByAdminUserId: adminUser.id
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "country_shipping.upsert",
        resourceType: "country_shipping_rule",
        resourceId: rule.id,
        metadata: { country, version, status },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { country: publicCountryRule(rule) };
    },

    async listRules(query = {}) {
      const country = query.country ? normalizeCountry(query.country) : "";
      const rules = await repository.listRules(country);
      return { rules: rules.map(publicCountryRule) };
    }
  };
}

export function publicCountryRule(rule) {
  return {
    id: rule.id,
    country: rule.country,
    version: rule.version,
    title: rule.title,
    summary: rule.summary,
    content: rule.content,
    status: rule.status,
    published_at: rule.publishedAt,
    expires_at: rule.expiresAt,
    updated_at: rule.updatedAt
  };
}

function normalizeCountry(value) {
  const country = requiredText(value, "country", 80);
  return country;
}

function normalizeStatus(value) {
  const status = String(value || "draft").trim().toLowerCase();
  if (!["draft", "published", "archived"].includes(status)) {
    throw badRequest("status is invalid.", { field: "status" });
  }
  return status;
}

function normalizeVersion(value) {
  if (value === undefined || value === null || value === "") return 1;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw badRequest("version must be a positive integer.", { field: "version" });
  }
  return version;
}

function normalizeContent(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
