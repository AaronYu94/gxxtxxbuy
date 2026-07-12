import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";

// V2-10-08/09/10 — promotional email campaigns, batch send/pause/retry, stats.
export function createEmailCampaignService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("Email campaign repository is required.");

  function requireCampaign(adminRoles) {
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("campaign_operator") || adminRoles.includes("super_admin"))) throw forbidden("Only campaign operators can manage email campaigns.");
  }

  return {
    async createCampaign(adminUser, adminRoles, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const templateCode = requiredText(input?.template_code, "template_code", 80);
      const campaign = await repository.createCampaign({
        name: optionalText(input?.name, "name", 120), templateCode, language: input?.language || "en",
        testMode: Boolean(input?.test_mode), batchSize: Number(input?.batch_size) || 100, adminId: adminUser.id
      });
      return { campaign: publicCampaign(campaign) };
    },
    async listCampaigns() { return { campaigns: (await repository.listCampaigns()).map(publicCampaign) }; },

    // V2-10-08 — schedule freezes the audience snapshot and builds batches.
    async scheduleCampaign(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const audience = Array.isArray(input?.audience) ? input.audience : [];
      if (audience.length === 0) throw badRequest("Audience is required to schedule.", { field: "audience" });
      const res = await repository.scheduleCampaign({ campaignId: id, audience });
      if (res.notFound) throw notFound("Campaign not found.");
      if (res.conflict) throw conflict("Only a draft campaign can be scheduled.", { code: "not_draft", status: res.status });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "email_campaign.schedule", resourceType: "email_campaign", resourceId: id, metadata: { batches: res.batches, recipients: res.recipients }, requestId: requestMeta.requestId }, { critical: true });
      return { campaign_id: id, batches: res.batches, recipients: res.recipients };
    },

    async listBatches(id) { return { batches: (await repository.listBatches(id)).map(publicBatch) }; },

    // V2-10-09 — send one batch (idempotent). A replayed job is a no-op.
    async sendBatch(adminUser, adminRoles, batchId, requestMeta = {}) {
      requireCampaign(adminRoles);
      const res = await repository.sendBatch({ batchId });
      if (res.notFound) throw notFound("Batch not found.");
      if (res.skipped) return { batch_id: batchId, skipped: true, status: res.status, delivered: 0 };
      return { batch_id: batchId, delivered: res.delivered, remaining_batches: res.remaining };
    },
    async pauseCampaign(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const res = await repository.pauseCampaign(id);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "email_campaign.pause", resourceType: "email_campaign", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return { campaign_id: id, paused_batches: res.paused };
    },
    async resumeCampaign(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const res = await repository.resumeCampaign(id);
      return { campaign_id: id, resumed_batches: res.resumed };
    },

    // V2-10-10 — provider webhook event (idempotent). Bot events don't move metrics.
    async recordEvent(input, requestMeta = {}) {
      const externalId = requiredText(input?.external_id, "external_id", 200);
      const campaignId = requiredText(input?.campaign_id, "campaign_id", 64);
      const email = requiredText(input?.email, "email", 320);
      const type = requiredText(input?.type, "type", 20);
      if (!["delivered", "open", "click", "bounce"].includes(type)) throw badRequest("Unknown event type.", { field: "type" });
      const res = await repository.recordEvent({ externalId, campaignId, email, type, isBot: Boolean(input?.is_bot) });
      return { recorded: res.created };
    },
    async getStats(id) {
      const campaign = await repository.findCampaign(id);
      if (!campaign) throw notFound("Campaign not found.");
      const stats = await repository.stats(id);
      // Test-mode campaigns report their sends but are flagged so dashboards exclude them.
      return { campaign_id: id, test_mode: campaign.testMode, stats };
    },

    async unsubscribe(input) {
      const email = requiredText(input?.email, "email", 320);
      await repository.unsubscribe(email);
      return { unsubscribed: true };
    }
  };
}

export function publicCampaign(c) {
  if (!c) return null;
  return { id: c.id, name: c.name, template_code: c.templateCode, language: c.language, status: c.status, test_mode: c.testMode, scheduled_at: c.scheduledAt };
}
export function publicBatch(b) {
  return { id: b.id, batch_no: b.batchNo, status: b.status, recipient_count: b.recipientCount, sent_at: b.sentAt };
}
