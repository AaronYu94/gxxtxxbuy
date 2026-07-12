import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { computeMetrics } from "./support-metrics.js";

// V2-10-12..16 — customer support conversations. Customer service can thread,
// reply, and resolve; it may LINK a conversation to an after-sales order but never
// changes after-sales state (that stays with the V2-08 owners).
export function createSupportService({ repository, userLookup = null, auditLogger = null } = {}) {
  if (!repository) throw new Error("Support repository is required.");

  function requireSupport(adminRoles) {
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("support_agent") || adminRoles.includes("super_admin"))) throw forbidden("Only support agents can act on conversations.");
  }

  // V2-10-13 — resolve an inbound to a user/business, only when it is unambiguous.
  async function matchInbound({ email, orderNo, parcelNo }) {
    if (!userLookup) return { requesterEmail: email || "", requesterUserId: null, relatedType: "", relatedId: "" };
    if (orderNo) {
      const u = await userLookup.findByOrderNo(orderNo);
      if (u) return { requesterEmail: email || u.email, requesterUserId: u.id, relatedType: "order", relatedId: orderNo };
    }
    if (parcelNo) {
      const u = await userLookup.findByParcelNo(parcelNo);
      if (u) return { requesterEmail: email || u.email, requesterUserId: u.id, relatedType: "parcel", relatedId: parcelNo };
    }
    if (email) {
      const u = await userLookup.findByEmail(email);
      if (u) return { requesterEmail: email, requesterUserId: u.id, relatedType: "", relatedId: "" };
    }
    // No unique match → do not guess; leave unlinked.
    return { requesterEmail: email || "", requesterUserId: null, relatedType: "", relatedId: "" };
  }

  return {
    // ---- V2-10-13 inbound webhook (idempotent + auto-link, no guessing) ----
    async ingestInbound(input, requestMeta = {}) {
      const externalId = requiredText(input?.external_id, "external_id", 200);
      // Dedup: an inbound already threaded is a no-op.
      const existingConv = await repository.findConversationByExternalMessage(externalId);
      if (existingConv) return { conversation_id: existingConv.id, deduped: true };

      const match = await matchInbound({ email: optionalText(input?.from_email, "from_email", 320), orderNo: optionalText(input?.order_no, "order_no", 64), parcelNo: optionalText(input?.parcel_no, "parcel_no", 64) });
      const conversation = await repository.createConversation({
        subject: optionalText(input?.subject, "subject", 240), channel: input?.channel === "live_chat" ? "live_chat" : "email",
        requesterUserId: match.requesterUserId, requesterEmail: match.requesterEmail, relatedType: match.relatedType, relatedId: match.relatedId
      });
      await repository.addMessage({
        conversationId: conversation.id, direction: "inbound", authorType: "user", body: String(input?.body || ""),
        attachmentKeys: Array.isArray(input?.attachment_keys) ? input.attachment_keys.map(String) : [], externalId, eventAt: input?.event_at || null
      });
      return { conversation_id: conversation.id, matched: Boolean(match.requesterUserId), related_type: match.relatedType || null, deduped: false };
    },

    async createConversation(adminUser, adminRoles, input, requestMeta = {}) {
      requireSupport(adminRoles);
      const conversation = await repository.createConversation({
        subject: optionalText(input?.subject, "subject", 240), channel: input?.channel === "live_chat" ? "live_chat" : "email",
        requesterEmail: optionalText(input?.requester_email, "requester_email", 320)
      });
      return this.getConversation(conversation.id);
    },
    async listConversations(query = {}) {
      const limit = [20, 50, 100].includes(Number(query.limit)) ? Number(query.limit) : 20;
      const rows = await repository.listConversations({ status: query.status ? String(query.status) : null, assignee: query.assignee || null, limit, offset: Number(query.offset) || 0 });
      return { conversations: rows.map(publicConversation), page_size: limit };
    },

    // ---- V2-10-14 claim / transfer / reply / resolve / reopen ----
    async claim(adminUser, adminRoles, id, requestMeta = {}) {
      requireSupport(adminRoles);
      const claimed = await repository.claim(id, adminUser.id);
      if (!claimed) {
        const c = await repository.findConversation(id);
        if (!c) throw notFound("Conversation not found.");
        throw conflict("Conversation is already claimed.", { code: "already_claimed" });
      }
      return this.getConversation(id);
    },
    async transfer(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireSupport(adminRoles);
      const toAdminId = requiredText(input?.to_admin_id, "to_admin_id", 64);
      const updated = await repository.transfer(id, toAdminId);
      if (!updated) throw notFound("Conversation not found.");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "support.transfer", resourceType: "support_conversation", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.getConversation(id);
    },
    async reply(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireSupport(adminRoles);
      const conversation = await repository.findConversation(id);
      if (!conversation) throw notFound("Conversation not found.");
      const body = requiredText(input?.body, "body", 20000);
      // Reply goes out on the conversation's original channel.
      await repository.addMessage({
        conversationId: id, direction: "outbound", authorType: "admin", authorAdminId: adminUser.id, body,
        attachmentKeys: Array.isArray(input?.attachment_keys) ? input.attachment_keys.map(String) : [], markFirstResponse: true
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "support.reply", resourceType: "support_conversation", resourceId: id, metadata: { channel: conversation.channel }, requestId: requestMeta.requestId }, { critical: false });
      return this.getConversation(id);
    },
    async resolve(adminUser, adminRoles, id, requestMeta = {}) {
      requireSupport(adminRoles);
      const res = await repository.setStatus({ conversationId: id, toStatus: "resolved", actorAdminId: adminUser.id, action: "resolve", stampResolved: true });
      if (res.notFound) throw notFound("Conversation not found.");
      return this.getConversation(id);
    },
    async reopen(adminUser, adminRoles, id, requestMeta = {}) {
      requireSupport(adminRoles);
      const res = await repository.setStatus({ conversationId: id, toStatus: "open", actorAdminId: adminUser.id, action: "reopen", bumpReopen: true });
      if (res.notFound) throw notFound("Conversation not found.");
      return this.getConversation(id);
    },

    // ---- V2-10-15 presale→aftersales link (read-only; never changes AS state) ----
    async linkAfterSales(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireSupport(adminRoles);
      const afterSalesId = requiredText(input?.after_sales_id, "after_sales_id", 64);
      const res = await repository.linkAfterSales({ conversationId: id, afterSalesId, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "support.link_after_sales", resourceType: "support_conversation", resourceId: id, metadata: { after_sales_id: afterSalesId, note: "link only, no state change" }, requestId: requestMeta.requestId }, { critical: false });
      return { linked: res.created, after_sales_id: afterSalesId };
    },

    async getConversation(id) {
      const conversation = await repository.findConversation(id);
      if (!conversation) throw notFound("Conversation not found.");
      const messages = await repository.listMessages(id);
      const links = await repository.listAfterSalesLinks(id);
      const metrics = computeMetrics(messages.map((m) => ({ direction: m.direction, eventAt: m.eventAt })), { resolvedAt: conversation.resolvedAt, reopenedCount: conversation.reopenedCount });
      return { conversation: publicConversation(conversation), messages: messages.map(publicMessage), after_sales_links: links, metrics };
    }
  };
}

export function publicConversation(c) {
  if (!c) return null;
  return { id: c.id, subject: c.subject, channel: c.channel, status: c.status, assignee_admin_id: c.assigneeAdminId, requester_email: c.requesterEmail, related_type: c.relatedType, related_id: c.relatedId, reopened_count: c.reopenedCount, created_at: c.createdAt };
}
export function publicMessage(m) {
  // Attachments are private storage keys — expose presence, not the raw keys.
  return { id: m.id, direction: m.direction, author_type: m.authorType, body: m.body, attachment_count: (m.attachmentKeys || []).length, event_at: m.eventAt };
}
