import { randomUUID } from "node:crypto";

// In-memory double for the banner repository (V2-10-05/06).
export class MemoryBannerRepository {
  constructor() { this.banners = new Map(); }

  async create(def) {
    const b = {
      id: randomUUID(), title: def.title || "", language: def.language || "en", countryCode: def.countryCode || "",
      desktopImageKey: def.desktopImageKey || "", tabletImageKey: def.tabletImageKey || "", mobileImageKey: def.mobileImageKey || "",
      linkUrl: def.linkUrl || "", sortOrder: def.sortOrder || 0, status: "draft", startsAt: def.startsAt || null, endsAt: def.endsAt || null, createdAt: new Date().toISOString()
    };
    this.banners.set(b.id, b);
    return { ...b };
  }
  async findById(id) { const b = this.banners.get(id); return b ? { ...b } : null; }
  async list() { return [...this.banners.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => ({ ...b })); }
  async update(id, patch) {
    const b = this.banners.get(id);
    for (const [k, v] of Object.entries(patch)) if (v !== null && v !== undefined) b[k] = v;
    return { ...b };
  }
  async setStatus(id, status) { const b = this.banners.get(id); if (!b) return null; b.status = status; return { ...b }; }
  async listLive({ language, country, nowIso }) {
    const now = Date.parse(nowIso);
    return [...this.banners.values()].filter((b) =>
      b.status === "published"
      && (!b.startsAt || Date.parse(b.startsAt) <= now)
      && (!b.endsAt || Date.parse(b.endsAt) > now)
      && (!language || b.language === language)
      && (b.countryCode === "" || !country || b.countryCode === country)
    ).sort((a, b) => a.sortOrder - b.sortOrder).map((b) => ({ ...b }));
  }
}
