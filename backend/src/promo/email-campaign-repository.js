import { getDbPool } from "../db/pool.js";

// V2-10-08/09/10 — promotional email campaigns, batches, recipients, events.
export function createPgEmailCampaignRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async createCampaign({ name, templateCode, language, testMode, batchSize, adminId }) {
      const r = await pool().query(
        `insert into email_campaigns (name, template_code, language, test_mode, batch_size, created_by_admin_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [name || "", templateCode, language || "en", Boolean(testMode), batchSize || 100, adminId || null]
      );
      return normalizeCampaign(r.rows[0]);
    },
    async findCampaign(id) { const r = await pool().query("select * from email_campaigns where id = $1", [id]); return normalizeCampaign(r.rows[0]); },
    async listCampaigns() { return (await pool().query("select * from email_campaigns order by created_at desc")).rows.map(normalizeCampaign); },

    // Freeze the audience snapshot, materialize recipients (skip unsubscribed), and
    // chunk into batches. Guarded so a campaign is only scheduled once.
    async scheduleCampaign({ campaignId, audience }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const c = (await client.query("select * from email_campaigns where id = $1 for update", [campaignId])).rows[0];
        if (!c) { await client.query("rollback"); return { notFound: true }; }
        if (c.status !== "draft") { await client.query("rollback"); return { conflict: true, status: c.status }; }
        // Dedup audience by email; check unsubscribes.
        const seen = new Set();
        const clean = [];
        for (const a of audience) {
          const email = String(a.email || "").trim().toLowerCase();
          if (!email || seen.has(email)) continue;
          seen.add(email);
          clean.push({ email, language: a.language || c.language });
        }
        const unsub = new Set((await client.query("select email from email_unsubscribes where email = any($1::text[])", [clean.map((x) => x.email)])).rows.map((r) => r.email));
        const batchSize = c.batch_size;
        let batchNo = 0;
        let batch = null;
        let inBatch = 0;
        for (const rcpt of clean) {
          if (!batch || inBatch >= batchSize) {
            batchNo += 1; inBatch = 0;
            batch = (await client.query("insert into email_campaign_batches (campaign_id, batch_no, status) values ($1, $2, 'pending') returning *", [campaignId, batchNo])).rows[0];
          }
          const status = unsub.has(rcpt.email) ? "unsubscribed" : "queued";
          await client.query(
            "insert into email_recipients (campaign_id, batch_id, email, language, status) values ($1, $2, $3, $4, $5) on conflict (campaign_id, email) do nothing",
            [campaignId, batch.id, rcpt.email, rcpt.language, status]
          );
          inBatch += 1;
          await client.query("update email_campaign_batches set recipient_count = recipient_count + 1 where id = $1", [batch.id]);
        }
        const updated = (await client.query(
          "update email_campaigns set status = 'scheduled', audience_snapshot = $2, scheduled_at = now() where id = $1 returning *",
          [campaignId, JSON.stringify(clean)]
        )).rows[0];
        await client.query("commit");
        return { campaign: normalizeCampaign(updated), batches: batchNo, recipients: clean.length };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },

    async listBatches(campaignId) {
      const r = await pool().query("select * from email_campaign_batches where campaign_id = $1 order by batch_no asc", [campaignId]);
      return r.rows.map(normalizeBatch);
    },

    // Send one batch: pending → sent, delivering queued recipients. Idempotent — a
    // batch not in 'pending' is a no-op (a replayed job never double-delivers).
    async sendBatch({ batchId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const batch = (await client.query("select * from email_campaign_batches where id = $1 for update", [batchId])).rows[0];
        if (!batch) { await client.query("rollback"); return { notFound: true }; }
        if (batch.status !== "pending") { await client.query("rollback"); return { skipped: true, status: batch.status }; }
        // Only queued recipients are delivered; unsubscribed/skipped are left as-is.
        const delivered = (await client.query(
          "update email_recipients set status = 'sent', delivered_at = now() where batch_id = $1 and status = 'queued' returning id",
          [batchId]
        )).rowCount;
        await client.query("update email_campaign_batches set status = 'sent', sent_at = now() where id = $1", [batchId]);
        // Mark the campaign sending; complete it when no pending batches remain.
        await client.query("update email_campaigns set status = 'sending' where id = $1 and status in ('scheduled','sending')", [batch.campaign_id]);
        const remaining = (await client.query("select count(*)::int c from email_campaign_batches where campaign_id = $1 and status = 'pending'", [batch.campaign_id])).rows[0].c;
        if (remaining === 0) await client.query("update email_campaigns set status = 'completed' where id = $1 and status = 'sending'", [batch.campaign_id]);
        await client.query("commit");
        return { delivered, remaining };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },

    // Pause: only pending batches are paused; sent batches are untouched.
    async pauseCampaign(campaignId) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const paused = (await client.query("update email_campaign_batches set status = 'paused' where campaign_id = $1 and status = 'pending' returning id", [campaignId])).rowCount;
        await client.query("update email_campaigns set status = 'paused' where id = $1 and status in ('scheduled','sending')", [campaignId]);
        await client.query("commit");
        return { paused };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    async resumeCampaign(campaignId) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const resumed = (await client.query("update email_campaign_batches set status = 'pending' where campaign_id = $1 and status = 'paused' returning id", [campaignId])).rowCount;
        await client.query("update email_campaigns set status = 'sending' where id = $1 and status = 'paused'", [campaignId]);
        await client.query("commit");
        return { resumed };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },

    // ---- V2-10-10 events (idempotent) ----
    async recordEvent({ externalId, campaignId, email, type, isBot }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const rcpt = (await client.query("select * from email_recipients where campaign_id = $1 and email = lower($2)", [campaignId, email])).rows[0];
        let inserted;
        try {
          inserted = (await client.query(
            "insert into email_events (external_id, recipient_id, type, is_bot) values ($1, $2, $3, $4) returning *",
            [externalId, rcpt ? rcpt.id : null, type, Boolean(isBot)]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); return { created: false }; } // replayed webhook
          throw error;
        }
        if (rcpt && !isBot) {
          if (type === "open") await client.query("update email_recipients set opened_at = coalesce(opened_at, now()) where id = $1", [rcpt.id]);
          if (type === "click") await client.query("update email_recipients set clicked_at = coalesce(clicked_at, now()) where id = $1", [rcpt.id]);
          if (type === "bounce") await client.query("update email_recipients set status = 'bounced' where id = $1", [rcpt.id]);
        }
        await client.query("commit");
        return { created: true, event: normalizeEvent(inserted) };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    async stats(campaignId) {
      const r = await pool().query(
        `select
           count(*) filter (where status = 'sent')::int sent,
           count(*) filter (where status = 'bounced')::int bounced,
           count(*) filter (where status = 'unsubscribed')::int unsubscribed,
           count(*) filter (where opened_at is not null)::int opened,
           count(*) filter (where clicked_at is not null)::int clicked
         from email_recipients where campaign_id = $1`,
        [campaignId]
      );
      return r.rows[0];
    },

    async unsubscribe(email) {
      await pool().query("insert into email_unsubscribes (email) values (lower($1)) on conflict do nothing", [email]);
    },
    async isUnsubscribed(email) {
      const r = await pool().query("select 1 from email_unsubscribes where email = lower($1)", [email]);
      return r.rowCount > 0;
    }
  };
}

export function normalizeCampaign(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, templateCode: row.template_code, language: row.language, status: row.status, scheduledAt: row.scheduled_at, testMode: row.test_mode, batchSize: row.batch_size, createdAt: row.created_at };
}
export function normalizeBatch(row) {
  if (!row) return null;
  return { id: row.id, campaignId: row.campaign_id, batchNo: row.batch_no, status: row.status, recipientCount: row.recipient_count, sentAt: row.sent_at };
}
export function normalizeEvent(row) {
  if (!row) return null;
  return { id: row.id, externalId: row.external_id, recipientId: row.recipient_id, type: row.type, isBot: row.is_bot, createdAt: row.created_at };
}
