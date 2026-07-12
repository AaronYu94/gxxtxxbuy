import { getDbPool } from "../db/pool.js";

// V2-10-12..16 — support conversations, messages, links.
export function createPgSupportRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async createConversation({ subject, channel, requesterUserId, requesterEmail, relatedType, relatedId }) {
      const r = await pool().query(
        `insert into support_conversations (subject, channel, requester_user_id, requester_email, related_type, related_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [subject || "", channel || "email", requesterUserId || null, requesterEmail || "", relatedType || "", relatedId || ""]
      );
      return normalizeConversation(r.rows[0]);
    },
    async findConversation(id) { const r = await pool().query("select * from support_conversations where id = $1", [id]); return normalizeConversation(r.rows[0]); },
    async listConversations({ status = null, assignee = null, limit = 20, offset = 0 } = {}) {
      const r = await pool().query(
        `select * from support_conversations where ($1::text is null or status = $1) and ($2::uuid is null or assignee_admin_id = $2)
         order by created_at desc limit $3 offset $4`,
        [status, assignee, Math.min(limit, 100), Math.max(0, offset)]
      );
      return r.rows.map(normalizeConversation);
    },
    async findConversationByExternalMessage(externalId) {
      const r = await pool().query(
        `select c.* from support_conversations c join support_messages m on m.conversation_id = c.id where m.external_id = $1 limit 1`,
        [externalId]
      );
      return normalizeConversation(r.rows[0]);
    },

    // Append a message. Inbound with a duplicate external id is a no-op (returns the
    // existing message), keeping the thread idempotent.
    async addMessage({ conversationId, direction, authorType, authorAdminId, body, attachmentKeys, externalId, eventAt, markFirstResponse = false }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        if (externalId) {
          const existing = (await client.query("select * from support_messages where external_id = $1", [externalId])).rows[0];
          if (existing) { await client.query("rollback"); return { message: normalizeMessage(existing), created: false }; }
        }
        let msg;
        try {
          msg = (await client.query(
            `insert into support_messages (conversation_id, direction, author_type, author_admin_id, body, attachment_keys, external_id, event_at)
             values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, now())) returning *`,
            [conversationId, direction, authorType || "user", authorAdminId || null, body || "", JSON.stringify(attachmentKeys || []), externalId || null, eventAt || null]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); const raced = (await pool().query("select * from support_messages where external_id = $1", [externalId])).rows[0]; return { message: normalizeMessage(raced), created: false }; }
          throw error;
        }
        if (markFirstResponse) {
          await client.query("update support_conversations set first_response_at = coalesce(first_response_at, now()) where id = $1", [conversationId]);
        }
        await client.query("commit");
        return { message: normalizeMessage(msg), created: true };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    async listMessages(conversationId) {
      const r = await pool().query("select * from support_messages where conversation_id = $1 order by event_at asc, created_at asc", [conversationId]);
      return r.rows.map(normalizeMessage);
    },

    // Single-owner claim (guarded on unassigned/open).
    async claim(conversationId, adminId) {
      const r = await pool().query(
        "update support_conversations set assignee_admin_id = $2, status = 'claimed' where id = $1 and assignee_admin_id is null returning *",
        [conversationId, adminId]
      );
      return normalizeConversation(r.rows[0]);
    },
    async transfer(conversationId, toAdminId) {
      const r = await pool().query("update support_conversations set assignee_admin_id = $2 where id = $1 returning *", [conversationId, toAdminId]);
      return normalizeConversation(r.rows[0]);
    },
    async setStatus({ conversationId, toStatus, actorAdminId, action, bumpReopen = false, stampResolved = false }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const c = (await client.query("select * from support_conversations where id = $1 for update", [conversationId])).rows[0];
        if (!c) { await client.query("rollback"); return { notFound: true }; }
        const from = c.status;
        const sets = ["status = $2"];
        const vals = [conversationId, toStatus];
        if (stampResolved) sets.push("resolved_at = now()");
        if (bumpReopen) sets.push("reopened_count = reopened_count + 1");
        const updated = (await client.query(`update support_conversations set ${sets.join(", ")} where id = $1 returning *`, vals)).rows[0];
        await client.query(
          "insert into support_status_history (conversation_id, from_status, to_status, action, actor_admin_id) values ($1, $2, $3, $4, $5)",
          [conversationId, from, toStatus, action, actorAdminId || null]
        );
        await client.query("commit");
        return { conversation: normalizeConversation(updated), from };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },

    async linkAfterSales({ conversationId, afterSalesId, adminId }) {
      try {
        const r = await pool().query(
          "insert into support_after_sales_links (conversation_id, after_sales_id, created_by_admin_id) values ($1, $2, $3) returning *",
          [conversationId, afterSalesId, adminId || null]
        );
        return { link: r.rows[0], created: true };
      } catch (error) { if (error.code === "23505") return { created: false }; throw error; }
    },
    async listAfterSalesLinks(conversationId) {
      const r = await pool().query("select after_sales_id from support_after_sales_links where conversation_id = $1", [conversationId]);
      return r.rows.map((x) => x.after_sales_id);
    }
  };
}

export function normalizeConversation(row) {
  if (!row) return null;
  return { id: row.id, subject: row.subject, channel: row.channel, status: row.status, assigneeAdminId: row.assignee_admin_id, requesterUserId: row.requester_user_id, requesterEmail: row.requester_email, relatedType: row.related_type, relatedId: row.related_id, firstResponseAt: row.first_response_at, resolvedAt: row.resolved_at, reopenedCount: row.reopened_count, createdAt: row.created_at };
}
export function normalizeMessage(row) {
  if (!row) return null;
  return { id: row.id, conversationId: row.conversation_id, direction: row.direction, authorType: row.author_type, authorAdminId: row.author_admin_id, body: row.body, attachmentKeys: row.attachment_keys || [], externalId: row.external_id, eventAt: row.event_at, createdAt: row.created_at };
}
