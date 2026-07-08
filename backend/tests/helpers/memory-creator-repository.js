import { randomUUID } from "node:crypto";
import {
  foldStats,
  normalizeAttribution,
  normalizeCampaign,
  normalizeCreator
} from "../../src/creators/creator-repository.js";

export class MemoryCreatorRepository {
  constructor() {
    this.creators = new Map();
    this.campaigns = new Map();
    this.attributions = new Map();
  }

  async createCreator(input) {
    const existing = Array.from(this.creators.values()).find((entry) => entry.code === input.code);
    const now = new Date().toISOString();
    const creator = normalizeCreator({
      id: existing?.id || randomUUID(),
      user_id: input.userId || existing?.userId || null,
      code: input.code,
      display_name: input.displayName || "",
      status: input.status || "active",
      created_by_admin_user_id: input.createdByAdminUserId || null,
      created_at: existing?.createdAt || now,
      updated_at: now
    });
    this.creators.set(creator.id, creator);
    return clone(creator);
  }

  async findCreatorById(id) {
    return clone(this.creators.get(id));
  }

  async findCreatorByCode(code) {
    return clone(Array.from(this.creators.values()).find((entry) => entry.code === code));
  }

  async findCreatorByUserId(userId) {
    return clone(Array.from(this.creators.values()).find((entry) => entry.userId === userId));
  }

  async createCampaign(input) {
    const existing = Array.from(this.campaigns.values()).find((entry) => entry.code === input.code);
    const now = new Date().toISOString();
    const campaign = normalizeCampaign({
      id: existing?.id || randomUUID(),
      creator_id: input.creatorId,
      code: input.code,
      name: input.name || "",
      landing_url: input.landingUrl || "",
      status: input.status || "active",
      created_at: existing?.createdAt || now,
      updated_at: now
    });
    this.campaigns.set(campaign.id, campaign);
    return clone(campaign);
  }

  async findCampaignByCode(code) {
    return clone(Array.from(this.campaigns.values()).find((entry) => entry.code === code));
  }

  async listCreatorCampaigns(creatorId) {
    return Array.from(this.campaigns.values())
      .filter((entry) => entry.creatorId === creatorId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(clone);
  }

  async recordAttribution(input) {
    const key = [input.creatorId, input.campaignId || "-", input.sessionId || "", input.touchType || "visit"].join("|");
    const existing = this.attributions.get(key);
    if (existing) {
      if (!existing.userId && input.userId) existing.userId = input.userId;
      return clone(existing);
    }
    const attribution = normalizeAttribution({
      id: randomUUID(),
      creator_id: input.creatorId,
      campaign_id: input.campaignId || null,
      session_id: input.sessionId || "",
      user_id: input.userId || null,
      purchase_order_id: input.purchaseOrderId || null,
      touch_type: input.touchType || "visit",
      created_at: new Date().toISOString()
    });
    this.attributions.set(key, attribution);
    return clone(attribution);
  }

  async getCreatorStats(creatorId) {
    const counts = new Map();
    for (const entry of this.attributions.values()) {
      if (entry.creatorId !== creatorId) continue;
      counts.set(entry.touchType, (counts.get(entry.touchType) || 0) + 1);
    }
    return foldStats(Array.from(counts.entries()).map(([touch_type, total]) => ({ touch_type, total })));
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
