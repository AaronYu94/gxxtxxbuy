import { badRequest, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";

const VALID_STATUS = ["open", "investigating", "resolved", "dismissed"];
const VALID_SEVERITY = ["low", "medium", "high"];
const LEGAL_TRANSITIONS = {
  open: ["investigating", "resolved", "dismissed"],
  investigating: ["resolved", "dismissed"],
  resolved: ["investigating"],
  dismissed: ["investigating"]
};

export function createRiskService({ repository, env, auditLogger = null } = {}) {
  if (!repository) throw new Error("Risk repository is required.");

  return {
    // B7-11: create a risk case.
    async createCase(adminUser, input = {}, requestMeta = {}) {
      const riskType = requiredText(input.risk_type ?? input.riskType, "risk_type", 60);
      const severity = normalizeSeverity(input.severity);
      const status = input.status ? normalizeStatus(input.status) : "open";
      const created = await repository.createCase({
        riskType,
        status,
        severity,
        subjectUserId: optionalText(input.subject_user_id ?? input.subjectUserId, "subject_user_id", 80) || null,
        subjectRef: optionalText(input.subject_ref ?? input.subjectRef, "subject_ref", 120),
        reason: optionalText(input.reason, "reason", 500),
        ownerAdminUserId: adminUser.id,
        metadata: normalizeMetadata(input.metadata),
        source: "manual",
        createdByAdminUserId: adminUser.id
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "risk.case.create",
        resourceType: "risk_case",
        resourceId: created.id,
        metadata: { risk_type: riskType, severity },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { case: publicRiskCase(created) };
    },

    async listCases(query = {}) {
      const status = query.status ? normalizeStatus(query.status) : "";
      const limit = clampLimit(query.limit);
      const offset = clampOffset(query.offset);
      const { cases, total } = await repository.listCases({ status, limit, offset });
      return {
        cases: cases.map(publicRiskCase),
        pagination: { total, limit, offset, has_more: offset + cases.length < total }
      };
    },

    // B7-11: update a case with a legal status transition.
    async updateCase(adminUser, caseId, input = {}, requestMeta = {}) {
      const current = await repository.findCaseById(requiredText(caseId, "case_id", 80));
      if (!current) throw notFound("Risk case not found.");
      const patch = {};
      if (input.status !== undefined) {
        const nextStatus = normalizeStatus(input.status);
        if (nextStatus !== current.status && !LEGAL_TRANSITIONS[current.status]?.includes(nextStatus)) {
          throw badRequest(`Illegal status transition from ${current.status} to ${nextStatus}.`, { field: "status" });
        }
        patch.status = nextStatus;
      }
      if (input.severity !== undefined) patch.severity = normalizeSeverity(input.severity);
      if (input.reason !== undefined) patch.reason = optionalText(input.reason, "reason", 500);
      if (input.owner_admin_user_id !== undefined || input.ownerAdminUserId !== undefined) {
        patch.ownerAdminUserId = optionalText(input.owner_admin_user_id ?? input.ownerAdminUserId, "owner_admin_user_id", 80) || null;
      }
      const updated = await repository.updateCase(current.id, patch);
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "risk.case.update",
        resourceType: "risk_case",
        resourceId: current.id,
        metadata: { status: updated.status, severity: updated.severity },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { case: publicRiskCase(updated) };
    },

    // B7-12: coupon-abuse rule. Disabled by default (RISK_COUPON_ABUSE_ENABLED) so it
    // never opens cases without an operator turning it on; threshold is configurable.
    async scanCouponAbuse(candidates = [], options = {}) {
      if (!env?.riskCouponAbuseEnabled && !options.force) {
        return { enabled: false, opened: 0, cases: [] };
      }
      const threshold = Number(options.threshold ?? env?.riskCouponAbuseThreshold ?? 5);
      const flagged = candidates.filter((entry) => Number(entry.redeemedCount) >= threshold);
      const cases = [];
      for (const entry of flagged) {
        const { case: riskCase, created } = await repository.createAutoCaseIfAbsent({
          riskType: "coupon_abuse",
          severity: "medium",
          subjectUserId: entry.userId || null,
          subjectRef: String(entry.userId || entry.subjectRef || ""),
          reason: `User redeemed ${entry.redeemedCount} coupons (threshold ${threshold}).`,
          metadata: { redeemed_count: entry.redeemedCount, threshold },
          source: "coupon_abuse"
        });
        if (created && riskCase) cases.push(publicRiskCase(riskCase));
      }
      return { enabled: true, threshold, scanned: candidates.length, opened: cases.length, cases };
    }
  };
}

export function publicRiskCase(riskCase) {
  return {
    id: riskCase.id,
    risk_type: riskCase.riskType,
    status: riskCase.status,
    severity: riskCase.severity,
    subject_user_id: riskCase.subjectUserId,
    subject_ref: riskCase.subjectRef,
    reason: riskCase.reason,
    owner_admin_user_id: riskCase.ownerAdminUserId,
    metadata: riskCase.metadata,
    source: riskCase.source,
    created_at: riskCase.createdAt,
    updated_at: riskCase.updatedAt,
    resolved_at: riskCase.resolvedAt
  };
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!VALID_STATUS.includes(status)) {
    throw badRequest("status is invalid.", { field: "status", allowed: VALID_STATUS });
  }
  return status;
}

function normalizeSeverity(value) {
  const severity = String(value || "medium").trim().toLowerCase();
  if (!VALID_SEVERITY.includes(severity)) {
    throw badRequest("severity is invalid.", { field: "severity", allowed: VALID_SEVERITY });
  }
  return severity;
}

function normalizeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clampLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 25;
  return Math.min(Math.floor(limit), 100);
}

function clampOffset(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
