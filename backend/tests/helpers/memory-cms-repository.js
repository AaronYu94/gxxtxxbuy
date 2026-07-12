import { randomUUID } from "node:crypto";

// In-memory double for the CMS repository (V2-10-07/11).
export class MemoryCmsRepository {
  constructor() { this.templates = []; this.configs = []; }

  async createTemplate({ code, language, subject, body, variables, adminId }) {
    const version = this.templates.filter((t) => t.code === code && t.language === language).reduce((m, t) => Math.max(m, t.version), 0) + 1;
    const t = { id: randomUUID(), code, language, subject: subject || "", body: body || "", variables: variables || [], version, status: "draft", createdAt: new Date().toISOString() };
    this.templates.push(t);
    return { ...t };
  }
  async findTemplateById(id) { const t = this.templates.find((x) => x.id === id); return t ? { ...t } : null; }
  async listTemplates() { return this.templates.map((t) => ({ ...t })); }
  async publishTemplate(id) {
    const t = this.templates.find((x) => x.id === id);
    if (!t) return { notFound: true };
    for (const o of this.templates) if (o.code === t.code && o.language === t.language && o.status === "published") o.status = "archived";
    t.status = "published";
    return { template: { ...t } };
  }
  async resolveTemplate(code, language, fallbackLanguage = "en") {
    const pub = this.templates.filter((t) => t.code === code && t.status === "published");
    return (pub.find((t) => t.language === language) || pub.find((t) => t.language === fallbackLanguage) || null) && { ...(pub.find((t) => t.language === language) || pub.find((t) => t.language === fallbackLanguage)) };
  }

  async publishConfigDoc({ kind, docKey, language, title, content, reason, effectiveAt, adminId }) {
    const version = this.configs.filter((c) => c.kind === kind && c.docKey === docKey && c.language === language).reduce((m, c) => Math.max(m, c.version), 0) + 1;
    for (const c of this.configs) if (c.kind === kind && c.docKey === docKey && c.language === language) c.active = false;
    const doc = { id: randomUUID(), kind, docKey, language, title: title || "", content: content || {}, version, active: true, reason: reason || "", effectiveAt: effectiveAt || new Date().toISOString(), createdAt: new Date().toISOString() };
    this.configs.push(doc);
    return { ...doc };
  }
  async getActiveConfigDoc(kind, docKey, language, fallbackLanguage = "en") {
    const act = this.configs.filter((c) => c.kind === kind && c.docKey === docKey && c.active);
    const found = act.find((c) => c.language === language) || act.find((c) => c.language === fallbackLanguage) || null;
    return found ? { ...found } : null;
  }
  async getConfigDocVersion(kind, docKey, language, version) {
    const c = this.configs.find((x) => x.kind === kind && x.docKey === docKey && x.language === language && x.version === version);
    return c ? { ...c } : null;
  }
  async listConfigDocVersions(kind, docKey) { return this.configs.filter((c) => c.kind === kind && c.docKey === docKey).map((c) => ({ ...c })); }
}
