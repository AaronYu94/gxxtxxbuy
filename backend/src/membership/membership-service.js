import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { requiredText } from "../core/core-input.js";
import { computeTier, validateTiers } from "./membership-tiers.js";

// V2-09-05/06/07 — membership tier config, growth-value ledger, membership center.
export function createMembershipService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("Membership repository is required.");

  function requireSuperAdmin(adminRoles) {
    if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) {
      throw forbidden("Only a super admin can configure membership tiers.");
    }
  }

  return {
    // ---- V2-09-05 tier config (super-admin, versioned) ----
    async publishConfig(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const tiers = Array.isArray(input?.tiers) ? input.tiers.map(normalizeTierInput) : [];
      const v = validateTiers(tiers);
      if (!v.ok) throw badRequest(`Invalid tier ladder: ${v.reason}`, { field: "tiers" });
      const config = await repository.setActiveConfig({ tiers, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "membership.publish_config", resourceType: "membership_config", resourceId: config.id, metadata: { version: config.version }, requestId: requestMeta.requestId }, { critical: true });
      return { config };
    },
    async getActiveConfig() {
      const config = await repository.getActiveConfig();
      return { config };
    },
    async listConfigVersions() {
      return { versions: await repository.listConfigVersions() };
    },

    // ---- V2-09-06 growth accrual / clawback (idempotent) ----
    // Only ever called with money the user actually paid / was refunded for
    // international shipping. A replayed event (same idempotency key) is a no-op.
    async accrueShipping(userId, { amountMinor, businessRef, idempotencyKey }) {
      const amount = Math.trunc(Number(amountMinor) || 0);
      if (amount <= 0) return { created: false, reason: "non_positive" };
      const key = idempotencyKey || `ship:${businessRef}`;
      const res = await repository.accrue({ userId, deltaMinor: amount, source: "shipping_paid", businessType: "international_shipping", businessRef, idempotencyKey: key });
      return { created: res.created };
    },
    async clawbackShipping(userId, { amountMinor, businessRef, idempotencyKey }) {
      const amount = Math.trunc(Number(amountMinor) || 0);
      if (amount <= 0) return { created: false, reason: "non_positive" };
      const key = idempotencyKey || `shipclaw:${businessRef}`;
      const res = await repository.accrue({ userId, deltaMinor: -amount, source: "refund_clawback", businessType: "international_shipping", businessRef, idempotencyKey: key });
      return { created: res.created };
    },

    // ---- V2-09-07 membership center (user) ----
    async getMembership(user) {
      const [config, total] = await Promise.all([repository.getActiveConfig(), repository.totalGrowth(user.id)]);
      const tiers = config ? config.tiers : [];
      const placement = computeTier(total, tiers);
      const ledger = await repository.listLedger(user.id, 20);
      return {
        config_version: config ? config.version : null,
        total_growth_cny_minor: total,
        tier: placement.tier ? publicTier(placement.tier) : null,
        next_tier: placement.next_tier ? publicTier(placement.next_tier) : null,
        to_next_cny_minor: placement.to_next_minor,
        freight_discount_bps: placement.freight_discount_bps,
        // Growth counts ONLY international shipping the user actually paid; refunds
        // claw it back (a downgrade is therefore fully explainable from this list).
        basis: "international_shipping_paid_minus_refunds",
        recent: ledger.map(publicLedger)
      };
    },

    // Adapter for the consolidation billing seam (V2-07-09): resolve a user's live
    // freight discount from their current tier.
    membershipProvider() {
      const repo = repository;
      return {
        async forUser(userId) {
          const config = await repo.getActiveConfig();
          if (!config) return null;
          const total = await repo.totalGrowth(userId);
          const placement = computeTier(total, config.tiers);
          return placement.freight_discount_bps > 0 ? { discountBps: placement.freight_discount_bps } : null;
        }
      };
    }
  };
}

function normalizeTierInput(t) {
  return {
    code: requiredText(t?.code, "tier.code", 40),
    name: String(t?.name || t?.code || ""),
    level: Number(t?.level),
    threshold_growth_minor: Number(t?.threshold_growth_minor),
    freight_discount_bps: Number(t?.freight_discount_bps || 0),
    benefits: t?.benefits && typeof t.benefits === "object" ? t.benefits : {}
  };
}

export function publicTier(t) {
  return { code: t.code, name: t.name, level: t.level, threshold_cny_minor: t.threshold_growth_minor, freight_discount_bps: t.freight_discount_bps || 0, benefits: t.benefits || {} };
}
export function publicLedger(l) {
  return { delta_cny_minor: l.deltaGrowthMinor, source: l.source, business_ref: l.businessRef, created_at: l.createdAt };
}
