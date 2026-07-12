import { getDbPool } from "../db/pool.js";

// V2-10-07/11 — email templates + config document versions.
export function createPgCmsRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- email templates ----
    async createTemplate({ code, language, subject, body, variables, adminId }) {
      const prev = (await pool().query("select coalesce(max(version), 0) v from email_templates where code = $1 and language = $2", [code, language])).rows[0];
      const r = await pool().query(
        `insert into email_templates (code, language, subject, body, variables, version, status, created_by_admin_id)
         values ($1, $2, $3, $4, $5, $6, 'draft', $7) returning *`,
        [code, language, subject || "", body || "", JSON.stringify(variables || []), Number(prev.v) + 1, adminId || null]
      );
      return normalizeTemplate(r.rows[0]);
    },
    async findTemplateById(id) { const r = await pool().query("select * from email_templates where id = $1", [id]); return normalizeTemplate(r.rows[0]); },
    async listTemplates() { return (await pool().query("select * from email_templates order by code, language, version desc")).rows.map(normalizeTemplate); },
    async publishTemplate(id) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const t = (await client.query("select * from email_templates where id = $1 for update", [id])).rows[0];
        if (!t) { await client.query("rollback"); return { notFound: true }; }
        await client.query("update email_templates set status = 'archived' where code = $1 and language = $2 and status = 'published'", [t.code, t.language]);
        const published = (await client.query("update email_templates set status = 'published' where id = $1 returning *", [id])).rows[0];
        await client.query("commit");
        return { template: normalizeTemplate(published) };
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    // Resolve a published template for a language, falling back to the default.
    async resolveTemplate(code, language, fallbackLanguage = "en") {
      const r = await pool().query(
        `select * from email_templates where code = $1 and status = 'published' and language in ($2, $3)
         order by (language = $2) desc limit 1`,
        [code, language, fallbackLanguage]
      );
      return normalizeTemplate(r.rows[0]);
    },

    // ---- config documents ----
    async publishConfigDoc({ kind, docKey, language, title, content, reason, effectiveAt, adminId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const prev = (await client.query("select coalesce(max(version), 0) v from config_documents where kind = $1 and doc_key = $2 and language = $3", [kind, docKey, language])).rows[0];
        await client.query("update config_documents set active = false where kind = $1 and doc_key = $2 and language = $3 and active", [kind, docKey, language]);
        const row = (await client.query(
          `insert into config_documents (kind, doc_key, language, title, content, version, active, reason, effective_at, created_by_admin_id)
           values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9) returning *`,
          [kind, docKey, language, title || "", JSON.stringify(content || {}), Number(prev.v) + 1, reason || "", effectiveAt || new Date().toISOString(), adminId || null]
        )).rows[0];
        await client.query("commit");
        return normalizeConfigDoc(row);
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
    async getActiveConfigDoc(kind, docKey, language, fallbackLanguage = "en") {
      const r = await pool().query(
        `select * from config_documents where kind = $1 and doc_key = $2 and active and language in ($3, $4)
         order by (language = $3) desc limit 1`,
        [kind, docKey, language, fallbackLanguage]
      );
      return normalizeConfigDoc(r.rows[0]);
    },
    async getConfigDocVersion(kind, docKey, language, version) {
      const r = await pool().query("select * from config_documents where kind = $1 and doc_key = $2 and language = $3 and version = $4", [kind, docKey, language, version]);
      return normalizeConfigDoc(r.rows[0]);
    },
    async listConfigDocVersions(kind, docKey) {
      const r = await pool().query("select * from config_documents where kind = $1 and doc_key = $2 order by language, version desc", [kind, docKey]);
      return r.rows.map(normalizeConfigDoc);
    }
  };
}

export function normalizeTemplate(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, language: row.language, subject: row.subject, body: row.body, variables: row.variables || [], version: row.version, status: row.status, createdAt: row.created_at };
}
export function normalizeConfigDoc(row) {
  if (!row) return null;
  return { id: row.id, kind: row.kind, docKey: row.doc_key, language: row.language, title: row.title, content: row.content || {}, version: row.version, active: row.active, reason: row.reason, effectiveAt: row.effective_at, createdAt: row.created_at };
}
