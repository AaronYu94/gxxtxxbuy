import { badRequest, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";

export function createCreatorService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("Creator repository is required.");

  return {
    // Record a creator/campaign touch. Public-safe: never stores addresses,
    // payment, or contact info; only a session id and optional attributed user.
    async recordTouch(input = {}, context = {}, requestMeta = {}) {
      const campaignCode = normalizeCode(input.campaign_code ?? input.campaignCode, false);
      const creatorCode = normalizeCode(input.creator_code ?? input.creatorCode, false);
      if (!campaignCode && !creatorCode) {
        throw badRequest("campaign_code or creator_code is required.", { field: "campaign_code" });
      }

      let campaign = null;
      let creator = null;
      if (campaignCode) {
        campaign = await repository.findCampaignByCode(campaignCode);
        if (!campaign || campaign.status !== "active") throw notFound("Campaign not found.");
        creator = await repository.findCreatorById(campaign.creatorId);
      } else {
        creator = await repository.findCreatorByCode(creatorCode);
      }
      if (!creator || creator.status !== "active") throw notFound("Creator not found.");

      const touchType = normalizeTouchType(input.touch_type ?? input.touchType);
      const attribution = await repository.recordAttribution({
        creatorId: creator.id,
        campaignId: campaign?.id || null,
        sessionId: optionalText(input.session_id ?? input.sessionId, "session_id", 120),
        userId: context.userId || null,
        touchType
      });
      await auditLogger?.write({
        actorType: context.userId ? "user" : "system",
        actorUserId: context.userId || null,
        action: "creator.touch",
        resourceType: "creator",
        resourceId: creator.id,
        metadata: { campaign_id: campaign?.id || null, touch_type: touchType },
        requestId: requestMeta.requestId
      }, { critical: false });

      return { attribution: publicAttribution(attribution) };
    },

    // Creator dashboard. Returns aggregate/redacted data only. A creator can
    // never see buyer addresses, order line items, or QC through this surface.
    async getDashboard(user) {
      const creator = await repository.findCreatorByUserId(user.id);
      if (!creator) throw forbidden("Current user is not a registered creator.");
      const [stats, campaigns] = await Promise.all([
        repository.getCreatorStats(creator.id),
        repository.listCreatorCampaigns(creator.id)
      ]);
      return {
        creator: publicCreator(creator),
        stats,
        campaigns: campaigns.map(publicCampaign)
      };
    },

    async createCreator(adminUser, input = {}, requestMeta = {}) {
      const creator = await repository.createCreator({
        userId: optionalText(input.user_id ?? input.userId, "user_id", 80) || null,
        code: normalizeCode(input.code, true),
        displayName: optionalText(input.display_name ?? input.displayName, "display_name", 160),
        status: normalizeStatus(input.status, ["active", "paused", "disabled"]),
        createdByAdminUserId: adminUser.id
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "creator.admin.create",
        resourceType: "creator",
        resourceId: creator.id,
        metadata: { code: creator.code },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { creator: publicCreator(creator) };
    },

    async createCampaign(adminUser, creatorId, input = {}, requestMeta = {}) {
      const creator = await repository.findCreatorById(requiredText(creatorId, "creator_id", 80));
      if (!creator) throw notFound("Creator not found.");
      const campaign = await repository.createCampaign({
        creatorId: creator.id,
        code: normalizeCode(input.code, true),
        name: optionalText(input.name, "name", 160),
        landingUrl: optionalText(input.landing_url ?? input.landingUrl, "landing_url", 500),
        status: normalizeStatus(input.status, ["active", "paused", "archived"])
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "creator.admin.campaign_create",
        resourceType: "creator_campaign",
        resourceId: campaign.id,
        metadata: { code: campaign.code, creator_id: creator.id },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { campaign: publicCampaign(campaign) };
    }
  };
}

export function publicCreator(creator) {
  return {
    id: creator.id,
    code: creator.code,
    display_name: creator.displayName,
    status: creator.status,
    created_at: creator.createdAt,
    updated_at: creator.updatedAt
  };
}

export function publicCampaign(campaign) {
  return {
    id: campaign.id,
    creator_id: campaign.creatorId,
    code: campaign.code,
    name: campaign.name,
    landing_url: campaign.landingUrl,
    status: campaign.status,
    created_at: campaign.createdAt,
    updated_at: campaign.updatedAt
  };
}

export function publicAttribution(attribution) {
  return {
    id: attribution.id,
    creator_id: attribution.creatorId,
    campaign_id: attribution.campaignId,
    touch_type: attribution.touchType,
    created_at: attribution.createdAt
  };
}

function normalizeCode(value, required) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    if (required) throw badRequest("code is required.", { field: "code" });
    return "";
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(text)) {
    throw badRequest("code must contain only letters, numbers, underscore, or dash.", { field: "code" });
  }
  return text;
}

function normalizeTouchType(value) {
  const type = String(value || "visit").trim().toLowerCase();
  if (!["visit", "signup", "order"].includes(type)) {
    throw badRequest("touch_type is invalid.", { field: "touch_type" });
  }
  return type;
}

function normalizeStatus(value, allowed) {
  const status = String(value || allowed[0]).trim().toLowerCase();
  if (!allowed.includes(status)) {
    throw badRequest("status is invalid.", { field: "status", allowed });
  }
  return status;
}
