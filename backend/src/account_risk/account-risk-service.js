import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { strictFingerprint, fuzzyKey, verdict } from "./address-fingerprint.js";

// V2-09-08/09/10 — account risk events, finance-initiated lock, super-admin approval.
export function createAccountRiskService({ repository, auditLogger = null, autoRulesEnabled = false } = {}) {
  if (!repository) throw new Error("Account risk repository is required.");

  function requireFinance(adminRoles) {
    // Only finance initiates a lock request.
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("finance_operator") || adminRoles.includes("super_admin"))) {
      throw forbidden("Only finance can initiate an account lock.");
    }
  }
  function requireSuperAdmin(adminRoles) {
    if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) {
      throw forbidden("Only a super admin can approve or unlock.");
    }
  }

  return {
    // ---- V2-09-08 record a risk event (idempotent; evidence isolated) ----
    async recordEvent(adminUser, input, requestMeta = {}) {
      const userId = requiredText(input?.user_id, "user_id", 64);
      const type = requiredText(input?.type, "type", 30);
      const externalId = requiredText(input?.external_id, "external_id", 200);
      const severity = ["low", "medium", "high"].includes(input?.severity) ? input.severity : "low";
      const res = await repository.recordEvent({
        userId, type, severity, detail: input?.detail && typeof input.detail === "object" ? input.detail : {},
        evidenceRef: optionalText(input?.evidence_ref, "evidence_ref", 512), autoRule: "", externalId
      });
      // Auto-rules are opt-in. When on, a high-severity event may raise a
      // finance-less, system-initiated lock request (still needs super-admin review).
      let autoRequest = null;
      if (res.created && autoRulesEnabled && severity === "high") {
        try {
          const r = await repository.createLockRequest({ userId, targetStatus: "risk_locked", reason: `auto: ${type} high-severity`, evidence: [], adminId: null });
          autoRequest = r.request;
        } catch (e) { if (e.code !== "ACTIVE_REQUEST_EXISTS") throw e; }
      }
      if (res.created) {
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.event", resourceType: "user", resourceId: userId, metadata: { type, severity }, requestId: requestMeta.requestId }, { critical: false });
      }
      return { recorded: res.created, event: res.event ? publicEvent(res.event) : null, auto_lock_request_id: autoRequest ? autoRequest.id : null };
    },
    async listEvents(userId) {
      return { events: (await repository.listEvents(userId)).map(publicEvent) };
    },

    // ---- V2-09-09 finance initiates a lock request ----
    async requestLock(adminUser, adminRoles, input, requestMeta = {}) {
      requireFinance(adminRoles);
      const userId = requiredText(input?.user_id, "user_id", 64);
      const targetStatus = input?.target_status === "banned" ? "banned" : "risk_locked";
      const reason = requiredText(input?.reason, "reason", 500); // reason mandatory
      const evidence = Array.isArray(input?.evidence) ? input.evidence.map(String).filter(Boolean) : [];
      if (evidence.length === 0) throw badRequest("Supporting evidence is required.", { field: "evidence" });
      try {
        const res = await repository.createLockRequest({ userId, targetStatus, reason, evidence, adminId: adminUser.id });
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.lock_request", resourceType: "user", resourceId: userId, metadata: { target_status: targetStatus }, requestId: requestMeta.requestId }, { critical: true });
        return { request: publicRequest(res.request) };
      } catch (e) {
        if (e.code === "ACTIVE_REQUEST_EXISTS") throw conflict("An active lock request already exists for this user.", { code: "active_request_exists" });
        throw e;
      }
    },
    async listRequests(query = {}) {
      return { requests: (await repository.listRequests({ status: query.status ? String(query.status) : null })).map(publicRequest) };
    },

    // ---- V2-09-10 super-admin approve / reject / unlock ----
    async approveLock(adminUser, adminRoles, requestId, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const request = await repository.findRequestById(requestId);
      if (!request) throw notFound("Lock request not found.");
      // The approver cannot be the initiator (maker-checker).
      if (request.initiatedByAdminId && request.initiatedByAdminId === adminUser.id) {
        throw forbidden("The initiator cannot approve their own lock request.");
      }
      const res = await repository.approveAndLock({ requestId, approverAdminId: adminUser.id });
      if (res.notFound) throw notFound("Lock request not found.");
      if (res.conflict) throw conflict("Lock request is not pending.", { code: "not_pending", status: res.status });
      if (res.userNotFound) throw notFound("User not found.");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.lock_approved", resourceType: "user", resourceId: res.userId, metadata: { to_status: res.toStatus }, requestId: requestMeta.requestId }, { critical: true });
      return { request: publicRequest(res.request), user_status: res.toStatus };
    },
    async rejectLock(adminUser, adminRoles, requestId, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const updated = await repository.rejectRequest({ requestId, approverAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
      if (!updated) throw conflict("Lock request is not pending.", { code: "not_pending" });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.lock_rejected", resourceType: "account_lock_request", resourceId: requestId, requestId: requestMeta.requestId }, { critical: true });
      return { request: publicRequest(updated) };
    },
    async unlock(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const userId = requiredText(input?.user_id, "user_id", 64);
      const res = await repository.unlockUser({ userId, approverAdminId: adminUser.id, reason: optionalText(input?.reason, "reason", 500) });
      if (res.notFound) throw notFound("User not found.");
      if (res.alreadyNormal) throw conflict("Account is already normal.", { code: "already_normal" });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.unlock", resourceType: "user", resourceId: userId, requestId: requestMeta.requestId }, { critical: true });
      return { user_id: userId, user_status: "normal" };
    },

    async getAccountStatus(userId) {
      const status = await repository.userStatus(userId);
      if (!status) throw notFound("User not found.");
      return { user_id: userId, status, history: (await repository.statusHistory(userId)).map(publicHistory) };
    },

    // ---- V2-09-11 address blacklist (address-only; hits → manual review) ----
    async addBlacklistAddress(adminUser, input, requestMeta = {}) {
      const addr = input?.address || {};
      const fp = strictFingerprint(addr);
      if (!fp) throw badRequest("A complete address is required to blacklist.", { field: "address" });
      const res = await repository.addBlacklistEntry({
        fingerprint: fp, fuzzyKey: fuzzyKey(addr), countryCode: addr.country_code || addr.countryCode || "",
        reason: optionalText(input?.reason, "reason", 500), adminId: adminUser.id
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.blacklist_add", resourceType: "address_blacklist", resourceId: res.entry ? res.entry.id : null, requestId: requestMeta.requestId }, { critical: true });
      return { added: res.created, entry: res.entry ? { id: res.entry.id, fingerprint: res.entry.fingerprint, reason: res.entry.reason } : null };
    },
    async listBlacklist() {
      const rows = await repository.listBlacklist();
      return { entries: rows.map((e) => ({ id: e.id, fingerprint: e.fingerprint, country_code: e.countryCode, reason: e.reason, created_at: e.createdAt })) };
    },

    // Check a candidate address. An exact or fuzzy hit creates a pending review
    // flag (never an automatic ban) and returns the verdict.
    async checkAddress(input, options = {}) {
      const addr = input?.address || {};
      const fp = strictFingerprint(addr);
      if (!fp) throw badRequest("A complete address is required.", { field: "address" });
      const exact = await repository.matchExact(fp);
      const fuzzy = await repository.matchFuzzy(fuzzyKey(addr), fp);
      const v = verdict({ exact, fuzzy });
      let flag = null;
      if (v.matched && options.flag !== false) {
        flag = await repository.createReviewFlag({ userId: input?.user_id || null, candidate: addr, matchKind: v.kind, blacklistId: exact ? exact.id : (fuzzy[0] ? fuzzy[0].id : null) });
      }
      return { matched: v.matched, kind: v.kind, action: v.action, review_flag_id: flag ? flag.id : null };
    },

    async listReviewFlags(query = {}) {
      const rows = await repository.listReviewFlags({ status: query.status ? String(query.status) : "pending" });
      return { flags: rows.map((f) => ({ id: f.id, user_id: f.userId, match_kind: f.matchKind, status: f.status, created_at: f.createdAt })) };
    },
    async decideReviewFlag(adminUser, flagId, input, requestMeta = {}) {
      const decision = input?.decision === "confirmed" ? "confirmed" : (input?.decision === "cleared" ? "cleared" : null);
      if (!decision) throw badRequest("decision must be 'cleared' or 'confirmed'.", { field: "decision" });
      const flag = await repository.decideReviewFlag({ flagId, status: decision });
      if (!flag) throw conflict("Review flag is not pending.", { code: "not_pending" });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "account_risk.address_review", resourceType: "address_review_flag", resourceId: flagId, metadata: { decision }, requestId: requestMeta.requestId }, { critical: true });
      return { flag: { id: flag.id, status: flag.status } };
    }
  };
}

export function publicEvent(e) {
  // The raw evidence_ref points into the isolated evidence domain and is not
  // returned in list responses; only a boolean presence flag is exposed.
  return { id: e.id, type: e.type, severity: e.severity, detail: e.detail, has_evidence: Boolean(e.evidenceRef), auto_rule: e.autoRule, created_at: e.createdAt };
}
export function publicRequest(r) {
  if (!r) return null;
  return { id: r.id, user_id: r.userId, target_status: r.targetStatus, reason: r.reason, status: r.status, decision_reason: r.decisionReason, decided_at: r.decidedAt, created_at: r.createdAt };
}
export function publicHistory(h) {
  return { from_status: h.fromStatus, to_status: h.toStatus, action: h.action, reason: h.reason, created_at: h.createdAt };
}
