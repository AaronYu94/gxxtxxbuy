import { randomUUID } from "node:crypto";

// In-memory double for the support repository (V2-10-12..16).
export class MemorySupportRepository {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.externalIds = new Set();
    this.links = [];
    this.history = [];
  }

  async createConversation({ subject, channel, requesterUserId, requesterEmail, relatedType, relatedId }) {
    const c = { id: randomUUID(), subject: subject || "", channel: channel || "email", status: "open", assigneeAdminId: null, requesterUserId: requesterUserId || null, requesterEmail: requesterEmail || "", relatedType: relatedType || "", relatedId: relatedId || "", firstResponseAt: null, resolvedAt: null, reopenedCount: 0, createdAt: new Date().toISOString() };
    this.conversations.set(c.id, c);
    return { ...c };
  }
  async findConversation(id) { const c = this.conversations.get(id); return c ? { ...c } : null; }
  async listConversations({ status = null, assignee = null, limit = 20, offset = 0 } = {}) {
    return [...this.conversations.values()].filter((c) => (!status || c.status === status) && (!assignee || c.assigneeAdminId === assignee)).slice(offset, offset + limit).map((c) => ({ ...c }));
  }
  async findConversationByExternalMessage(externalId) {
    const m = this.messages.find((x) => x.externalId === externalId);
    return m ? this.findConversation(m.conversationId) : null;
  }
  async addMessage({ conversationId, direction, authorType, authorAdminId, body, attachmentKeys, externalId, eventAt, markFirstResponse = false }) {
    if (externalId && this.externalIds.has(externalId)) {
      const existing = this.messages.find((m) => m.externalId === externalId);
      return { message: { ...existing }, created: false };
    }
    if (externalId) this.externalIds.add(externalId);
    const msg = { id: randomUUID(), conversationId, direction, authorType: authorType || "user", authorAdminId: authorAdminId || null, body: body || "", attachmentKeys: attachmentKeys || [], externalId: externalId || null, eventAt: eventAt || new Date().toISOString(), createdAt: new Date().toISOString() };
    this.messages.push(msg);
    if (markFirstResponse) { const c = this.conversations.get(conversationId); if (c && !c.firstResponseAt) c.firstResponseAt = new Date().toISOString(); }
    return { message: { ...msg }, created: true };
  }
  async listMessages(conversationId) { return this.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt)).map((m) => ({ ...m })); }

  async claim(conversationId, adminId) {
    const c = this.conversations.get(conversationId);
    if (!c || c.assigneeAdminId) return null;
    c.assigneeAdminId = adminId; c.status = "claimed";
    return { ...c };
  }
  async transfer(conversationId, toAdminId) { const c = this.conversations.get(conversationId); if (!c) return null; c.assigneeAdminId = toAdminId; return { ...c }; }
  async setStatus({ conversationId, toStatus, actorAdminId, action, bumpReopen = false, stampResolved = false }) {
    const c = this.conversations.get(conversationId);
    if (!c) return { notFound: true };
    const from = c.status;
    c.status = toStatus;
    if (stampResolved) c.resolvedAt = new Date().toISOString();
    if (bumpReopen) c.reopenedCount += 1;
    this.history.push({ conversationId, fromStatus: from, toStatus, action, actorAdminId });
    return { conversation: { ...c }, from };
  }
  async linkAfterSales({ conversationId, afterSalesId, adminId }) {
    if (this.links.some((l) => l.conversationId === conversationId && l.afterSalesId === afterSalesId)) return { created: false };
    this.links.push({ conversationId, afterSalesId, adminId });
    return { link: { conversationId, afterSalesId }, created: true };
  }
  async listAfterSalesLinks(conversationId) { return this.links.filter((l) => l.conversationId === conversationId).map((l) => l.afterSalesId); }
}
