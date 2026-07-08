import { getDbPool } from "../db/pool.js";

export function createPgCountryRepository(env) {
  return {
    async upsertRule(input) {
      const result = await getDbPool(env).query(
        `insert into country_shipping_rules (country, version, title, summary, content, status, published_at, expires_at, created_by_admin_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (country, version) do update
         set title = excluded.title,
             summary = excluded.summary,
             content = excluded.content,
             status = excluded.status,
             published_at = excluded.published_at,
             expires_at = excluded.expires_at
         returning *`,
        [
          input.country,
          input.version,
          input.title || "",
          input.summary || "",
          input.content || {},
          input.status || "draft",
          input.publishedAt || null,
          input.expiresAt || null,
          input.createdByAdminUserId || null
        ]
      );
      return normalizeCountryRule(result.rows[0]);
    },

    // Latest published version for a country.
    async findPublishedRule(country) {
      const result = await getDbPool(env).query(
        `select * from country_shipping_rules
         where country = $1 and status = 'published'
         order by version desc limit 1`,
        [country]
      );
      return normalizeCountryRule(result.rows[0]);
    },

    async listRules(country = "") {
      const result = await getDbPool(env).query(
        `select * from country_shipping_rules
         where ($1 = '' or country = $1)
         order by country asc, version desc`,
        [country]
      );
      return result.rows.map(normalizeCountryRule);
    }
  };
}

export function normalizeCountryRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    country: row.country,
    version: Number(row.version),
    title: row.title ?? "",
    summary: row.summary ?? "",
    content: row.content ?? {},
    status: row.status,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    createdByAdminUserId: row.created_by_admin_user_id ?? row.createdByAdminUserId ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}
