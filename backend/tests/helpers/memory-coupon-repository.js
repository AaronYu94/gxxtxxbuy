import { randomUUID } from "node:crypto";

// In-memory double for the coupon repository (V2-10-01/02/03/04).
export class MemoryCouponRepository {
  constructor() {
    this.coupons = new Map();  // id -> coupon
    this.grants = [];          // grant rows
    this.keys = new Set();     // idempotency keys
  }

  async createCoupon(def) {
    for (const c of this.coupons.values()) if (c.code === def.code) { const e = new Error("dup"); e.code = "COUPON_EXISTS"; throw e; }
    const c = {
      id: randomUUID(), code: def.code, name: def.name || "", discountType: def.discountType,
      fixedValueMinor: def.fixedValueMinor || 0, percentBps: def.percentBps || 0, thresholdMinMinor: def.thresholdMinMinor || 0,
      thresholdDiscountMinor: def.thresholdDiscountMinor || 0, maxDiscountMinor: def.maxDiscountMinor || 0,
      eligibleCountries: def.eligibleCountries || [], eligibleRouteCodes: def.eligibleRouteCodes || [],
      totalQuota: def.totalQuota ?? null, grantedCount: 0, perUserLimit: def.perUserLimit || 1,
      claimStartsAt: def.claimStartsAt || null, claimEndsAt: def.claimEndsAt || null, useStartsAt: def.useStartsAt || null, useEndsAt: def.useEndsAt || null,
      status: "draft", version: 1, createdAt: new Date().toISOString()
    };
    this.coupons.set(c.id, c);
    return { ...c };
  }
  async findByCode(code) { for (const c of this.coupons.values()) if (c.code === code) return { ...c }; return null; }
  async findById(id) { const c = this.coupons.get(id); return c ? { ...c } : null; }
  async listCoupons() { return [...this.coupons.values()].map((c) => ({ ...c })); }
  async setStatus(id, status) { const c = this.coupons.get(id); if (!c) return null; c.status = status; c.version += 1; return { ...c }; }
  async updateMutable(id, patch) {
    const c = this.coupons.get(id);
    if (patch.name != null) c.name = patch.name;
    if (patch.totalQuota != null) c.totalQuota = patch.totalQuota;
    if (patch.perUserLimit != null) c.perUserLimit = patch.perUserLimit;
    if (patch.claimEndsAt != null) c.claimEndsAt = patch.claimEndsAt;
    if (patch.useEndsAt != null) c.useEndsAt = patch.useEndsAt;
    c.version += 1;
    return { ...c };
  }

  async grant({ couponId, userId, source, idempotencyKey }) {
    if (idempotencyKey && this.keys.has(idempotencyKey)) {
      const existing = this.grants.find((g) => g.idempotencyKey === idempotencyKey);
      return { grant: existing ? { ...existing } : null, created: false };
    }
    const coupon = this.coupons.get(couponId);
    if (!coupon) { const e = new Error("no"); e.code = "COUPON_NOT_FOUND"; throw e; }
    if (coupon.status !== "active") { const e = new Error("no"); e.code = "COUPON_INACTIVE"; throw e; }
    if (coupon.totalQuota != null && coupon.grantedCount >= coupon.totalQuota) { const e = new Error("no"); e.code = "QUOTA_EXHAUSTED"; throw e; }
    const held = this.grants.filter((g) => g.couponId === couponId && g.userId === userId && g.status !== "revoked").length;
    if (held >= coupon.perUserLimit) { const e = new Error("no"); e.code = "PER_USER_LIMIT"; throw e; }
    coupon.grantedCount += 1;
    if (idempotencyKey) this.keys.add(idempotencyKey);
    const grant = { id: randomUUID(), couponId, userId, source: source || "grant", status: "available", reservedParcelId: null, usedParcelId: null, discountMinor: 0, idempotencyKey: idempotencyKey || null, createdAt: new Date().toISOString() };
    this.grants.push(grant);
    return { grant: { ...grant }, created: true };
  }

  async listUserGrants(userId, { status = null } = {}) {
    return this.grants.filter((g) => g.userId === userId && (!status || g.status === status)).map((g) => {
      const c = this.coupons.get(g.couponId);
      return { ...g, couponCode: c?.code, discountType: c?.discountType, couponStatus: c?.status };
    });
  }
  async findGrantForUserCoupon(userId, couponId) {
    const g = this.grants.find((x) => x.userId === userId && x.couponId === couponId && x.status === "available");
    return g ? { ...g } : null;
  }
  async reserve({ grantId, parcelId, discountMinor }) {
    const g = this.grants.find((x) => x.id === grantId);
    if (!g) return { notFound: true };
    if (g.status !== "available") return { conflict: true, status: g.status };
    if (this.grants.some((x) => x.reservedParcelId === parcelId && x.status === "reserved")) return { parcelTaken: true };
    g.status = "reserved"; g.reservedParcelId = parcelId; g.discountMinor = discountMinor || 0;
    return { grant: { ...g } };
  }
  async settleForParcel(parcelId) {
    const settled = this.grants.filter((g) => g.reservedParcelId === parcelId && g.status === "reserved");
    for (const g of settled) { g.status = "used"; g.usedParcelId = parcelId; g.reservedParcelId = null; }
    return settled.map((g) => ({ ...g }));
  }
  async releaseForParcel(parcelId) {
    const released = this.grants.filter((g) => g.reservedParcelId === parcelId && g.status === "reserved");
    for (const g of released) { g.status = "available"; g.reservedParcelId = null; g.discountMinor = 0; }
    return released.map((g) => ({ ...g }));
  }
  async findReservedForParcel(parcelId) { const g = this.grants.find((x) => x.reservedParcelId === parcelId && x.status === "reserved"); return g ? { ...g } : null; }
}
