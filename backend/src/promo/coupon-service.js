import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { validateCouponDef, isCouponEligible, couponDiscount } from "./coupon-rules.js";

// V2-10-01/02/03/04 — international-shipping coupon service.
export function createCouponService({ repository, auditLogger = null, clock = () => Date.now() } = {}) {
  if (!repository) throw new Error("Coupon repository is required.");

  function requireCampaign(adminRoles) {
    if (!Array.isArray(adminRoles) || !(adminRoles.includes("campaign_operator") || adminRoles.includes("super_admin"))) {
      throw forbidden("Only campaign operators can manage coupons.");
    }
  }

  const service = {
    // ---- V2-10-01/02 create + version management ----
    async createCoupon(adminUser, adminRoles, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const v = validateCouponDef(input);
      if (!v.ok) throw badRequest(`Invalid coupon: ${v.reason}`, { field: "coupon" });
      const code = requiredText(input?.code, "code", 60);
      try {
        const coupon = await repository.createCoupon({
          code, name: optionalText(input?.name, "name", 120), discountType: input.discount_type,
          fixedValueMinor: input.fixed_value_minor || 0, percentBps: input.percent_bps || 0,
          thresholdMinMinor: input.threshold_min_minor || 0, thresholdDiscountMinor: input.threshold_discount_minor || 0,
          maxDiscountMinor: input.max_discount_minor || 0, eligibleCountries: input.eligible_countries || [], eligibleRouteCodes: input.eligible_route_codes || [],
          totalQuota: input.total_quota ?? null, perUserLimit: input.per_user_limit || 1,
          claimStartsAt: input.claim_starts_at || null, claimEndsAt: input.claim_ends_at || null,
          useStartsAt: input.use_starts_at || null, useEndsAt: input.use_ends_at || null, adminId: adminUser.id
        });
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "coupon.create", resourceType: "promo_coupon", resourceId: coupon.id, requestId: requestMeta.requestId }, { critical: false });
        return { coupon: publicCoupon(coupon) };
      } catch (e) { if (e.code === "COUPON_EXISTS") throw conflict("A coupon with this code already exists.", { code: "coupon_exists" }); throw e; }
    },
    async publishCoupon(adminUser, adminRoles, id, requestMeta = {}) {
      requireCampaign(adminRoles);
      const coupon = await repository.findById(id);
      if (!coupon) throw notFound("Coupon not found.");
      if (coupon.status === "archived") throw conflict("An archived coupon cannot be published.", { code: "archived" });
      const updated = await repository.setStatus(id, "active");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "coupon.publish", resourceType: "promo_coupon", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { coupon: publicCoupon(updated) };
    },
    async updateCoupon(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const coupon = await repository.findById(id);
      if (!coupon) throw notFound("Coupon not found.");
      // Once active, only mutable (non-key) fields may change — key rules are frozen.
      if (coupon.status === "active") {
        const frozen = ["discount_type", "fixed_value_minor", "percent_bps", "threshold_min_minor", "threshold_discount_minor", "max_discount_minor", "eligible_countries", "eligible_route_codes"];
        for (const f of frozen) if (input[f] !== undefined) throw conflict(`Cannot change a frozen rule (${f}) on an active coupon.`, { code: "frozen_rule", field: f });
      }
      const updated = await repository.updateMutable(id, {
        name: input.name != null ? String(input.name).slice(0, 120) : null,
        totalQuota: input.total_quota ?? null, perUserLimit: input.per_user_limit ?? null,
        claimEndsAt: input.claim_ends_at ?? null, useEndsAt: input.use_ends_at ?? null
      });
      return { coupon: publicCoupon(updated) };
    },
    async listCoupons() { return { coupons: (await repository.listCoupons()).map(publicCoupon) }; },
    async disableCoupon(adminUser, adminRoles, id) {
      requireCampaign(adminRoles);
      const updated = await repository.setStatus(id, "disabled");
      if (!updated) throw notFound("Coupon not found.");
      return { coupon: publicCoupon(updated) };
    },

    // ---- V2-10-03 grant / redeem / signup ----
    async grant(adminUser, adminRoles, input, requestMeta = {}) {
      requireCampaign(adminRoles);
      const couponCode = requiredText(input?.coupon_code, "coupon_code", 60);
      const userId = requiredText(input?.user_id, "user_id", 64);
      const coupon = await repository.findByCode(couponCode);
      if (!coupon) throw notFound("Coupon not found.");
      return this._grant(coupon, userId, "grant", input?.idempotency_key || null);
    },
    async redeemCode(user, input, requestMeta = {}) {
      const couponCode = requiredText(input?.coupon_code, "coupon_code", 60);
      const coupon = await repository.findByCode(couponCode);
      if (!coupon) throw notFound("Coupon not found.");
      // Redeem is one-per-user-per-coupon via the per-user limit; make idempotent per code.
      return this._grant(coupon, user.id, "redeem_code", `redeem:${coupon.id}:${user.id}`);
    },
    async autoGrantOnSignup(userId, couponCode) {
      const coupon = await repository.findByCode(couponCode);
      if (!coupon || coupon.status !== "active") return { granted: false };
      try {
        return await this._grant(coupon, userId, "signup", `signup:${coupon.id}:${userId}`);
      } catch (e) { return { granted: false, reason: e.code || "error" }; }
    },
    async _grant(coupon, userId, source, idempotencyKey) {
      try {
        const res = await repository.grant({ couponId: coupon.id, userId, source, idempotencyKey });
        return { granted: res.created, grant_id: res.grant ? res.grant.id : null };
      } catch (e) {
        if (e.code === "COUPON_INACTIVE") throw conflict("Coupon is not active.", { code: "inactive" });
        if (e.code === "QUOTA_EXHAUSTED") throw conflict("Coupon quota is exhausted.", { code: "quota_exhausted" });
        if (e.code === "PER_USER_LIMIT") throw conflict("You have already claimed this coupon.", { code: "per_user_limit" });
        throw e;
      }
    },
    async listMyCoupons(user) {
      return { coupons: (await repository.listUserGrants(user.id, {})).map(publicGrant) };
    },

    // ---- V2-10-04 eligibility / reservation / settlement (shipping) ----
    async listEligible(user, context = {}) {
      const grants = await repository.listUserGrants(user.id, { status: "available" });
      const nowMs = clock();
      const out = [];
      for (const g of grants) {
        const coupon = await repository.findById(g.couponId);
        const elig = isCouponEligible(coupon, { country: context.country, routeCode: context.route_code, shippingMinor: Number(context.shipping_minor) || 0, nowMs });
        if (elig.eligible) out.push({ grant_id: g.id, coupon_code: g.couponCode, discount_minor: couponDiscount(coupon, Number(context.shipping_minor) || 0) });
      }
      return { eligible: out };
    },

    // Reserve a coupon against a parcel for a given shipping subtotal. Returns the
    // discount to apply. Concurrent reservations for the same parcel: one wins.
    async reserveForParcel(userId, { couponCode, parcelId, country, routeCode, shippingMinor }) {
      if (!couponCode) return { discount_minor: 0, grant_id: null };
      const coupon = await repository.findByCode(couponCode);
      if (!coupon) throw notFound("Coupon not found.");
      const elig = isCouponEligible(coupon, { country, routeCode, shippingMinor, nowMs: clock() });
      if (!elig.eligible) throw conflict(`Coupon not eligible: ${elig.reason}`, { code: elig.reason });
      const grant = await repository.findGrantForUserCoupon(userId, coupon.id);
      if (!grant) throw conflict("You do not hold this coupon.", { code: "not_held" });
      const discount = couponDiscount(coupon, shippingMinor);
      const res = await repository.reserve({ grantId: grant.id, parcelId, discountMinor: discount });
      if (res.notFound) throw notFound("Coupon grant not found.");
      if (res.parcelTaken) throw conflict("A coupon is already reserved for this parcel.", { code: "parcel_has_coupon" });
      if (res.conflict) throw conflict("Coupon is no longer available.", { code: "not_available", status: res.status });
      return { discount_minor: discount, grant_id: res.grant.id };
    },
    async settleForParcel(parcelId) { return { settled: (await repository.settleForParcel(parcelId)).length }; },
    async releaseForParcel(parcelId) { return { released: (await repository.releaseForParcel(parcelId)).length }; }
  };
  return service;
}

export function publicCoupon(c) {
  if (!c) return null;
  return { id: c.id, code: c.code, name: c.name, discount_type: c.discountType, status: c.status, version: c.version, total_quota: c.totalQuota, granted_count: c.grantedCount, per_user_limit: c.perUserLimit, use_ends_at: c.useEndsAt };
}
export function publicGrant(g) {
  return { id: g.id, coupon_code: g.couponCode, status: g.status, discount_minor: g.discountMinor, created_at: g.createdAt };
}
