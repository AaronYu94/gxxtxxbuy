import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { validateTemplate, render } from "./template-render.js";

// V2-10-07/11 — email templates (ops) + config version center (super-admin).
export function createCmsService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("CMS repository is required.");

  function requireCampaign(adminRoles) {
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("campaign_operator") || adminRoles.includes("super_admin"))) throw forbidden("Only campaign operators can manage templates.");
  }
  function requireSuperAdmin(adminRoles) {
    if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) throw forbidden("Only a super admin can publish config.");
  }

  return {
    // ---- V2-10-07 email templates ----
    async createTemplate(adminUser, adminRoles, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const code = requiredText(input?.code, "code", 80);
      const language = requiredText(input?.language, "language", 12);
      const variables = Array.isArray(input?.variables) ? input.variables.map(String) : [];
      const t = await repository.createTemplate({ code, language, subject: optionalText(input?.subject, "subject", 512), body: String(input?.body || ""), variables, adminId: adminUser.id });
      return { template: publicTemplate(t) };
    },
    async listTemplates() { return { templates: (await repository.listTemplates()).map(publicTemplate) }; },

    // Publish blocks when the body references any undeclared variable.
    async publishTemplate(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const t = await repository.findTemplateById(id);
      if (!t) throw notFound("Template not found.");
      const v = validateTemplate({ subject: t.subject, body: t.body, variables: t.variables });
      if (!v.ok) throw badRequest(`Cannot publish: ${v.reason}`, { code: "undeclared_variables" });
      const res = await repository.publishTemplate(id);
      if (res.notFound) throw notFound("Template not found.");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "cms.template_publish", resourceType: "email_template", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { template: publicTemplate(res.template) };
    },

    // Resolve + render a template for a language (falls back to default). Records
    // the exact version so a sent email keeps its template version.
    async renderTemplate(code, language, values = {}) {
      const t = await repository.resolveTemplate(code, language, "en");
      if (!t) throw notFound("No published template for this code.");
      const rendered = render({ subject: t.subject, body: t.body }, values);
      return { template_code: code, template_version: t.version, language: t.language, ...rendered };
    },

    // ---- V2-10-11 config version center (super-admin) ----
    async publishConfigDoc(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const kind = requiredText(input?.kind, "kind", 20);
      if (!["agreement", "announcement", "notice", "public_config"].includes(kind)) throw badRequest("Invalid kind.", { field: "kind" });
      const docKey = requiredText(input?.doc_key, "doc_key", 120);
      const language = requiredText(input?.language, "language", 12);
      const reason = requiredText(input?.reason, "reason", 500); // publish reason mandatory
      const doc = await repository.publishConfigDoc({
        kind, docKey, language, title: optionalText(input?.title, "title", 240),
        content: input?.content && typeof input.content === "object" ? input.content : {},
        reason, effectiveAt: input?.effective_at || new Date().toISOString(), adminId: adminUser.id
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "cms.config_publish", resourceType: "config_document", resourceId: doc.id, metadata: { kind, doc_key: docKey, version: doc.version }, requestId: requestMeta.requestId }, { critical: true });
      return { document: publicConfigDoc(doc) };
    },
    async getConfigDoc(kind, docKey, language) {
      const doc = await repository.getActiveConfigDoc(kind, docKey, language || "en", "en");
      if (!doc) throw notFound("Config document not found.");
      return { document: publicConfigDoc(doc) };
    },
    // Historical business pins a specific version so it always reads what it agreed to.
    async getConfigDocVersion(kind, docKey, language, version) {
      const doc = await repository.getConfigDocVersion(kind, docKey, language, Number(version));
      if (!doc) throw notFound("Config document version not found.");
      return { document: publicConfigDoc(doc) };
    },
    async listConfigDocVersions(kind, docKey) {
      return { versions: (await repository.listConfigDocVersions(kind, docKey)).map(publicConfigDoc) };
    }
  };
}

export function publicTemplate(t) {
  if (!t) return null;
  return { id: t.id, code: t.code, language: t.language, subject: t.subject, variables: t.variables, version: t.version, status: t.status };
}
export function publicConfigDoc(d) {
  if (!d) return null;
  return { id: d.id, kind: d.kind, doc_key: d.docKey, language: d.language, title: d.title, content: d.content, version: d.version, active: d.active, reason: d.reason, effective_at: d.effectiveAt };
}
