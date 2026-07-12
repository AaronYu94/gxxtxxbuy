import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText } from "../core/core-input.js";
import { isComplete, isSafeLink, imageForDevice, isLive } from "./banner-rules.js";

// V2-10-05/06 — banner management (campaign ops) + front-of-house read.
export function createBannerService({ repository, auditLogger = null, clock = () => Date.now() } = {}) {
  if (!repository) throw new Error("Banner repository is required.");

  function requireCampaign(adminRoles) {
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("campaign_operator") || adminRoles.includes("super_admin"))) {
      throw forbidden("Only campaign operators can manage banners.");
    }
  }
  function parsePatch(input) {
    const patch = {};
    for (const [k, col] of [["title", "title"], ["language", "language"], ["country_code", "countryCode"], ["desktop_image_key", "desktopImageKey"], ["tablet_image_key", "tabletImageKey"], ["mobile_image_key", "mobileImageKey"], ["link_url", "linkUrl"]]) {
      if (input[k] !== undefined) patch[col] = optionalText(input[k], k, 512);
    }
    if (input.sort_order !== undefined) patch.sortOrder = Number(input.sort_order) || 0;
    if (input.starts_at !== undefined) patch.startsAt = input.starts_at || null;
    if (input.ends_at !== undefined) patch.endsAt = input.ends_at || null;
    if (patch.linkUrl !== undefined && !isSafeLink(patch.linkUrl)) throw badRequest("Redirect link is not a safe URL.", { field: "link_url" });
    return patch;
  }

  return {
    async createBanner(adminUser, adminRoles, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const patch = parsePatch(input);
      const banner = await repository.create({ ...patch, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "banner.create", resourceType: "banner", resourceId: banner.id, requestId: requestMeta.requestId }, { critical: false });
      return { banner: publicBanner(banner) };
    },
    async updateBanner(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const existing = await repository.findById(id);
      if (!existing) throw notFound("Banner not found.");
      const updated = await repository.update(id, parsePatch(input));
      return { banner: publicBanner(updated) };
    },
    async listBanners() { return { banners: (await repository.list()).map(publicBanner) }; },

    // Preview shows exactly what would render (all device images + resolved live-ness).
    async previewBanner(id) {
      const banner = await repository.findById(id);
      if (!banner) throw notFound("Banner not found.");
      return { banner: publicBanner(banner), complete: isComplete(banner), would_be_live_now: banner.status === "published" && isLive(banner, clock()) };
    },

    // V2-10-06 — publish requires a complete asset set + a safe link.
    async publishBanner(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const banner = await repository.findById(id);
      if (!banner) throw notFound("Banner not found.");
      if (!isComplete(banner)) throw conflict("All three device images are required to publish.", { code: "incomplete_assets" });
      if (!isSafeLink(banner.linkUrl)) throw conflict("Redirect link is not a safe URL.", { code: "unsafe_link" });
      const updated = await repository.setStatus(id, "published");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "banner.publish", resourceType: "banner", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { banner: publicBanner(updated) };
    },
    async unpublishBanner(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const updated = await repository.setStatus(id, "unpublished");
      if (!updated) throw notFound("Banner not found.");
      return { banner: publicBanner(updated) };
    },

    // Front-of-house read: only live banners, resolved to the requesting device's
    // image. Expired banners drop out automatically (nowIso window filter), so a
    // stale cache never shows a taken-down or expired banner.
    async listForClient(query = {}) {
      const nowIso = new Date(clock()).toISOString();
      const device = ["desktop", "tablet", "mobile"].includes(query.device) ? query.device : "desktop";
      const rows = await repository.listLive({ language: query.language || "en", country: query.country || null, nowIso });
      return {
        banners: rows.filter((b) => isComplete(b)).map((b) => ({
          id: b.id, title: b.title, image_key: imageForDevice(b, device), link_url: b.linkUrl, sort_order: b.sortOrder
        }))
      };
    }
  };
}

export function publicBanner(b) {
  if (!b) return null;
  return {
    id: b.id, title: b.title, language: b.language, country_code: b.countryCode, status: b.status,
    desktop_image_key: b.desktopImageKey, tablet_image_key: b.tabletImageKey, mobile_image_key: b.mobileImageKey,
    link_url: b.linkUrl, sort_order: b.sortOrder, starts_at: b.startsAt, ends_at: b.endsAt
  };
}
