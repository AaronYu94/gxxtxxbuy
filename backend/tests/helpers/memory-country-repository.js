import { randomUUID } from "node:crypto";
import { normalizeCountryRule } from "../../src/country/country-repository.js";

export class MemoryCountryRepository {
  constructor() {
    this.rules = new Map();
  }

  async upsertRule(input) {
    const key = `${input.country}|${input.version}`;
    const existing = Array.from(this.rules.values()).find((entry) => `${entry.country}|${entry.version}` === key);
    const now = new Date().toISOString();
    const rule = normalizeCountryRule({
      id: existing?.id || randomUUID(),
      country: input.country,
      version: input.version,
      title: input.title || "",
      summary: input.summary || "",
      content: input.content || {},
      status: input.status || "draft",
      published_at: input.publishedAt || null,
      expires_at: input.expiresAt || null,
      created_by_admin_user_id: input.createdByAdminUserId || null,
      created_at: existing?.createdAt || now,
      updated_at: now
    });
    this.rules.set(rule.id, rule);
    return clone(rule);
  }

  async findPublishedRule(country) {
    const published = Array.from(this.rules.values())
      .filter((entry) => entry.country === country && entry.status === "published")
      .sort((a, b) => b.version - a.version);
    return clone(published[0]);
  }

  async listRules(country = "") {
    return Array.from(this.rules.values())
      .filter((entry) => !country || entry.country === country)
      .sort((a, b) => a.country.localeCompare(b.country) || b.version - a.version)
      .map(clone);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
