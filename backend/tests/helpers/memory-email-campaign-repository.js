import { randomUUID } from "node:crypto";

// In-memory double for the email campaign repository (V2-10-08/09/10).
export class MemoryEmailCampaignRepository {
  constructor() {
    this.campaigns = new Map();
    this.batches = new Map();
    this.recipients = [];
    this.eventIds = new Set();
    this.unsubs = new Set();
  }

  async createCampaign({ name, templateCode, language, testMode, batchSize, adminId }) {
    const c = { id: randomUUID(), name: name || "", templateCode, language: language || "en", status: "draft", scheduledAt: null, testMode: Boolean(testMode), batchSize: batchSize || 100, audienceSnapshot: [], createdAt: new Date().toISOString() };
    this.campaigns.set(c.id, c);
    return { ...c };
  }
  async findCampaign(id) { const c = this.campaigns.get(id); return c ? { ...c } : null; }
  async listCampaigns() { return [...this.campaigns.values()].map((c) => ({ ...c })); }

  async scheduleCampaign({ campaignId, audience }) {
    const c = this.campaigns.get(campaignId);
    if (!c) return { notFound: true };
    if (c.status !== "draft") return { conflict: true, status: c.status };
    const seen = new Set(); const clean = [];
    for (const a of audience) { const e = String(a.email || "").trim().toLowerCase(); if (!e || seen.has(e)) continue; seen.add(e); clean.push({ email: e, language: a.language || c.language }); }
    let batchNo = 0; let batch = null; let inBatch = 0;
    for (const r of clean) {
      if (!batch || inBatch >= c.batchSize) { batchNo += 1; inBatch = 0; batch = { id: randomUUID(), campaignId, batchNo, status: "pending", recipientCount: 0, sentAt: null }; this.batches.set(batch.id, batch); }
      const status = this.unsubs.has(r.email) ? "unsubscribed" : "queued";
      this.recipients.push({ id: randomUUID(), campaignId, batchId: batch.id, email: r.email, language: r.language, status, deliveredAt: null, openedAt: null, clickedAt: null });
      inBatch += 1; batch.recipientCount += 1;
    }
    c.status = "scheduled"; c.audienceSnapshot = clean; c.scheduledAt = new Date().toISOString();
    return { campaign: { ...c }, batches: batchNo, recipients: clean.length };
  }
  async listBatches(campaignId) { return [...this.batches.values()].filter((b) => b.campaignId === campaignId).sort((a, b) => a.batchNo - b.batchNo).map((b) => ({ ...b })); }

  async sendBatch({ batchId }) {
    const batch = this.batches.get(batchId);
    if (!batch) return { notFound: true };
    if (batch.status !== "pending") return { skipped: true, status: batch.status };
    let delivered = 0;
    for (const r of this.recipients) if (r.batchId === batchId && r.status === "queued") { r.status = "sent"; r.deliveredAt = new Date().toISOString(); delivered += 1; }
    batch.status = "sent"; batch.sentAt = new Date().toISOString();
    const c = this.campaigns.get(batch.campaignId);
    if (c && ["scheduled", "sending"].includes(c.status)) c.status = "sending";
    const remaining = [...this.batches.values()].filter((b) => b.campaignId === batch.campaignId && b.status === "pending").length;
    if (remaining === 0 && c && c.status === "sending") c.status = "completed";
    return { delivered, remaining };
  }
  async pauseCampaign(campaignId) {
    let paused = 0;
    for (const b of this.batches.values()) if (b.campaignId === campaignId && b.status === "pending") { b.status = "paused"; paused += 1; }
    const c = this.campaigns.get(campaignId);
    if (c && ["scheduled", "sending"].includes(c.status)) c.status = "paused";
    return { paused };
  }
  async resumeCampaign(campaignId) {
    let resumed = 0;
    for (const b of this.batches.values()) if (b.campaignId === campaignId && b.status === "paused") { b.status = "pending"; resumed += 1; }
    const c = this.campaigns.get(campaignId);
    if (c && c.status === "paused") c.status = "sending";
    return { resumed };
  }

  async recordEvent({ externalId, campaignId, email, type, isBot }) {
    if (this.eventIds.has(externalId)) return { created: false };
    this.eventIds.add(externalId);
    const r = this.recipients.find((x) => x.campaignId === campaignId && x.email === String(email).toLowerCase());
    if (r && !isBot) {
      if (type === "open") r.openedAt = r.openedAt || new Date().toISOString();
      if (type === "click") r.clickedAt = r.clickedAt || new Date().toISOString();
      if (type === "bounce") r.status = "bounced";
    }
    return { created: true, event: { id: randomUUID(), externalId, type, isBot: Boolean(isBot) } };
  }
  async stats(campaignId) {
    const rs = this.recipients.filter((r) => r.campaignId === campaignId);
    return {
      sent: rs.filter((r) => r.status === "sent").length,
      bounced: rs.filter((r) => r.status === "bounced").length,
      unsubscribed: rs.filter((r) => r.status === "unsubscribed").length,
      opened: rs.filter((r) => r.openedAt).length,
      clicked: rs.filter((r) => r.clickedAt).length
    };
  }
  async unsubscribe(email) { this.unsubs.add(String(email).toLowerCase()); }
  async isUnsubscribed(email) { return this.unsubs.has(String(email).toLowerCase()); }
}
