import { getDbPool } from "../db/pool.js";

// V2-10-05/06 — homepage carousel banners.
export function createPgBannerRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async create(def) {
      const r = await pool().query(
        `insert into banners (title, language, country_code, desktop_image_key, tablet_image_key, mobile_image_key, link_url, sort_order, starts_at, ends_at, created_by_admin_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [def.title || "", def.language || "en", def.countryCode || "", def.desktopImageKey || "", def.tabletImageKey || "", def.mobileImageKey || "", def.linkUrl || "", def.sortOrder || 0, def.startsAt || null, def.endsAt || null, def.adminId || null]
      );
      return normalizeBanner(r.rows[0]);
    },
    async findById(id) { const r = await pool().query("select * from banners where id = $1", [id]); return normalizeBanner(r.rows[0]); },
    async list() { return (await pool().query("select * from banners order by sort_order asc, created_at desc")).rows.map(normalizeBanner); },
    async update(id, patch) {
      const r = await pool().query(
        `update banners set title = coalesce($2, title), language = coalesce($3, language), country_code = coalesce($4, country_code),
           desktop_image_key = coalesce($5, desktop_image_key), tablet_image_key = coalesce($6, tablet_image_key), mobile_image_key = coalesce($7, mobile_image_key),
           link_url = coalesce($8, link_url), sort_order = coalesce($9, sort_order), starts_at = coalesce($10, starts_at), ends_at = coalesce($11, ends_at)
         where id = $1 returning *`,
        [id, patch.title ?? null, patch.language ?? null, patch.countryCode ?? null, patch.desktopImageKey ?? null, patch.tabletImageKey ?? null, patch.mobileImageKey ?? null, patch.linkUrl ?? null, patch.sortOrder ?? null, patch.startsAt ?? null, patch.endsAt ?? null]
      );
      return normalizeBanner(r.rows[0]);
    },
    async setStatus(id, status) { const r = await pool().query("update banners set status = $2 where id = $1 returning *", [id, status]); return normalizeBanner(r.rows[0]); },

    // Front-of-house: published + in-window, filtered by language/country, ordered.
    // Country match: exact or a global (empty country) banner.
    async listLive({ language, country, nowIso }) {
      const r = await pool().query(
        `select * from banners
           where status = 'published'
             and (starts_at is null or starts_at <= $3::timestamptz)
             and (ends_at is null or ends_at > $3::timestamptz)
             and ($1::text is null or language = $1)
             and (country_code = '' or country_code = coalesce($2, country_code))
           order by sort_order asc, created_at desc`,
        [language || null, country || null, nowIso]
      );
      return r.rows.map(normalizeBanner);
    }
  };
}

export function normalizeBanner(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, language: row.language, countryCode: row.country_code,
    desktopImageKey: row.desktop_image_key, tabletImageKey: row.tablet_image_key, mobileImageKey: row.mobile_image_key,
    linkUrl: row.link_url, sortOrder: row.sort_order, status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at
  };
}
