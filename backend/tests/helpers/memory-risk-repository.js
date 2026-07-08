import { randomUUID } from "node:crypto";
import { normalizeRiskCase } from "../../src/risk/risk-repository.js";

export class MemoryRiskRepository {
  constructor() {
    this.cases = new Map();
  }

  async createCase(input) {
    const now = new Date().toISOString();
    const riskCase = normalizeRiskCase({
      id: randomUUID(),
      risk_type: input.riskType,
      status: input.status || "open",
      severity: input.severity || "medium",
      subject_user_id: input.subjectUserId || null,
      subject_ref: input.subjectRef || "",
      reason: input.reason || "",
      owner_admin_user_id: input.ownerAdminUserId || null,
      metadata: input.metadata || {},
      source: input.source || "manual",
      created_by_admin_user_id: input.createdByAdminUserId || null,
      created_at: now,
      updated_at: now
    });
    this.cases.set(riskCase.id, riskCase);
    return clone(riskCase);
  }

  async createAutoCaseIfAbsent(input) {
    const existing = Array.from(this.cases.values()).find((entry) =>
      entry.source === input.source &&
      entry.riskType === input.riskType &&
      entry.subjectRef === (input.subjectRef || "") &&
      ["open", "investigating"].includes(entry.status));
    if (existing) return { case: clone(existing), created: false };
    const created = await this.createCase(input);
    return { case: created, created: true };
  }

  async findCaseById(id) {
    return clone(this.cases.get(id));
  }

  async listCases({ status = "", limit = 25, offset = 0 } = {}) {
    const all = Array.from(this.cases.values())
      .filter((entry) => !status || entry.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { cases: all.slice(offset, offset + limit).map(clone), total: all.length };
  }

  async updateCase(id, patch) {
    const riskCase = this.cases.get(id);
    if (!riskCase) return null;
    if (patch.status) {
      riskCase.status = patch.status;
      if (["resolved", "dismissed"].includes(patch.status)) riskCase.resolvedAt = new Date().toISOString();
    }
    if (patch.severity) riskCase.severity = patch.severity;
    if (patch.reason !== undefined && patch.reason !== null) riskCase.reason = patch.reason;
    if (patch.ownerAdminUserId !== undefined) riskCase.ownerAdminUserId = patch.ownerAdminUserId;
    riskCase.updatedAt = new Date().toISOString();
    return clone(riskCase);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
