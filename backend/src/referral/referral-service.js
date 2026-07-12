import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { maskEmail } from "../users_admin/user-view.js";
import { validateTiers, computeTier, DEFAULT_TIERS } from "./referral-tiers.js";

// V2-11-01..05 — invitation relationships, referral codes, signup binding, tier
// config, and the effective-amount ledger that drives promoter level.
export function createReferralService({ repository, officialBaseUrl = "https://goatedbuy.example", auditLogger = null } = {}) {
  if (!repository) throw new Error("Referral repository is required.");

  function requireSuperAdmin(adminRoles) {
    if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) throw forbidden("Only a super admin can configure promotion tiers.");
  }
  async function activeTiers() {
    const config = await repository.getActiveTierConfig();
    return config ? config.tiers : DEFAULT_TIERS;
  }

  return {
    // ---- V2-11-02 code / link / QR (repeated generation returns the same code) ----
    async getMyCode(user) {
      const code = await repository.ensureCode(user.id, generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.referral));
      return this._share(code.code);
    },
    _share(code) {
      // The QR encodes ONLY the official signup link (never arbitrary content).
      const link = `${officialBaseUrl}/signup?ref=${encodeURIComponent(code)}`;
      return { code, link, qr_payload: link };
    },
    async lookupCode(code) {
      const rec = await repository.findCode(code);
      if (!rec) throw notFound("Referral code not found.");
      return { code: rec.code, valid: true };
    },

    // ---- V2-11-03 signup binding (invalid code never blocks; concurrent binds once) ----
    // Returns { bound, reason }. Never throws for an invalid code — records the reason.
    async bindOnSignup(inviteeUserId, code, source = "signup") {
      if (!code) { return { bound: false, reason: "no_code" }; }
      const rec = await repository.findCode(String(code).trim());
      if (!rec) { await repository.recordAttempt({ inviteeId: inviteeUserId, code, reason: "invalid_code" }); return { bound: false, reason: "invalid_code" }; }
      const inviterId = rec.userId;
      if (inviterId === inviteeUserId) { await repository.recordAttempt({ inviteeId: inviteeUserId, code, reason: "self_invite" }); return { bound: false, reason: "self_invite" }; }
      // Already bound? (permanent)
      const existing = await repository.findBindingByInvitee(inviteeUserId);
      if (existing) { return { bound: false, reason: "already_bound" }; }
      // Cycle: inviter is a descendant of invitee (invitee appears in inviter's chain).
      const inviterChain = await repository.findInviterChain(inviterId);
      if (inviterChain.includes(inviteeUserId)) { await repository.recordAttempt({ inviteeId: inviteeUserId, code, reason: "cycle" }); return { bound: false, reason: "cycle" }; }

      const res = await repository.createBinding({ inviteeId: inviteeUserId, inviterId, code, source });
      await auditLogger?.write?.({ actorType: "system", action: "referral.bind", resourceType: "user", resourceId: inviteeUserId, metadata: { inviter: inviterId } }, { critical: false }).catch(() => {});
      return { bound: res.created, reason: res.created ? null : "already_bound", inviter_user_id: inviterId };
    },

    async getMyReferral(user) {
      const code = await repository.ensureCode(user.id, generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.referral));
      const inviteeCount = await repository.countInvitees(user.id);
      const binding = await repository.findBindingByInvitee(user.id);
      return { ...this._share(code.code), invitee_count: inviteeCount, has_inviter: Boolean(binding) };
    },

    // ---- V2-11-04 tier config (super-admin, versioned) ----
    async publishTierConfig(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const tiers = Array.isArray(input?.tiers) ? input.tiers.map(normalizeTierInput) : [];
      const v = validateTiers(tiers);
      if (!v.ok) throw badRequest(`Invalid tier ladder: ${v.reason}`, { field: "tiers" });
      const config = await repository.setActiveTierConfig({ tiers, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "referral.publish_tiers", resourceType: "referral_tier_config", resourceId: config.id, metadata: { version: config.version }, requestId: requestMeta.requestId }, { critical: true });
      return { config };
    },
    async getActiveTierConfig() {
      const config = await repository.getActiveTierConfig();
      return { config: config || { version: 0, tiers: DEFAULT_TIERS, active: false, default: true } };
    },
    async listTierConfigVersions() { return { versions: await repository.listTierConfigVersions() }; },

    // ---- V2-11-05 effective-amount accrual (idempotent) + promoter level ----
    // Called with the FROZEN commission base of an invitee's qualifying event.
    async accrueEffective(promoterId, { amountMinor, businessRef, idempotencyKey }) {
      const amount = Math.trunc(Number(amountMinor) || 0);
      if (amount <= 0) return { created: false };
      const res = await repository.accrueEffective({ promoterId, deltaMinor: amount, source: "signed_parcel", businessRef, idempotencyKey: idempotencyKey || `eff:${businessRef}` });
      return { created: res.created };
    },
    async clawbackEffective(promoterId, { amountMinor, businessRef, idempotencyKey }) {
      const amount = Math.trunc(Number(amountMinor) || 0);
      if (amount <= 0) return { created: false };
      const res = await repository.accrueEffective({ promoterId, deltaMinor: -amount, source: "refund_clawback", businessRef, idempotencyKey: idempotencyKey || `effclaw:${businessRef}` });
      return { created: res.created };
    },
    async getPromoterLevel(promoterId) {
      const [tiers, total] = await Promise.all([activeTiers(), repository.totalEffective(promoterId)]);
      const placement = computeTier(total, tiers);
      return {
        total_effective_cny_minor: total,
        level: placement.tier ? placement.tier.level : 1,
        tier_code: placement.tier ? placement.tier.code : null,
        commission_bps: placement.commission_bps,
        next_tier: placement.next_tier ? { code: placement.next_tier.code, level: placement.next_tier.level } : null,
        to_next_cny_minor: placement.to_next_minor
      };
    },
    // The inviter of an invitee (for commission attribution).
    async inviterOf(inviteeId) { return repository.findInviterOf(inviteeId); },

    // Admin (referral ops) view of a promoter's invitees — masked identifiers only.
    async listInviteesMasked(inviterId, userLookup) {
      const invitees = await repository.listInvitees(inviterId);
      const out = [];
      for (const inv of invitees) {
        const u = userLookup ? await userLookup.findById(inv.inviteeId) : null;
        out.push({ invitee_email_masked: u ? maskEmail(u.email) : "", bound_at: inv.createdAt });
      }
      return { invitees: out, count: invitees.length };
    }
  };
}

function normalizeTierInput(t) {
  return {
    code: String(t?.code || ""), level: Number(t?.level),
    threshold_minor: Number(t?.threshold_minor), commission_bps: Number(t?.commission_bps)
  };
}
