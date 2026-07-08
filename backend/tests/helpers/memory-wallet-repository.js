import { randomUUID } from "node:crypto";
import {
  normalizeCheckoutCouponApplication,
  normalizeCheckoutParcel,
  normalizeCoupon,
  normalizeUserCoupon,
  normalizeUserCouponWithCoupon,
  normalizeWallet,
  normalizeWalletTransaction,
  normalizeWelcomeGiftClaim
} from "../../src/wallet/wallet-repository.js";

export class MemoryWalletRepository {
  constructor({ shippingRepository = null } = {}) {
    this.shippingRepository = shippingRepository;
    this.wallets = new Map();
    this.transactions = new Map();
    this.coupons = new Map();
    this.couponsByCode = new Map();
    this.userCoupons = new Map();
    this.welcomeClaims = new Map();
    this.applications = new Map();
  }

  async ensureWallet(userId) {
    const existing = Array.from(this.wallets.values()).find((wallet) => wallet.userId === userId);
    if (existing) return clone(existing);
    const now = new Date().toISOString();
    const wallet = normalizeWallet({
      id: randomUUID(),
      userId,
      balanceCents: 0,
      currency: "USD",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    this.wallets.set(wallet.id, wallet);
    return clone(wallet);
  }

  async listWalletTransactions(userId) {
    return Array.from(this.transactions.values())
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(clone);
  }

  async listUserCoupons(userId) {
    return Array.from(this.userCoupons.values())
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => String(b.redeemedAt).localeCompare(String(a.redeemedAt)))
      .map((entry) => this.withCoupon(entry));
  }

  async findCouponByCode(code) {
    return clone(this.coupons.get(this.couponsByCode.get(code)));
  }

  async findCouponById(couponId) {
    return clone(this.coupons.get(couponId));
  }

  async upsertCoupon(input) {
    const existingId = this.couponsByCode.get(input.code);
    const now = new Date().toISOString();
    const coupon = normalizeCoupon({
      id: existingId || randomUUID(),
      code: input.code,
      title: input.title,
      description: input.description,
      status: input.status,
      couponType: input.couponType,
      discountType: input.discountType,
      amountCents: input.amountCents,
      percentOff: input.percentOff,
      maxDiscountCents: input.maxDiscountCents,
      minShippingFeeCents: input.minShippingFeeCents,
      currency: input.currency,
      eligibleShippingLineCodes: input.eligibleShippingLineCodes || [],
      combinable: input.combinable,
      totalRedemptions: input.totalRedemptions,
      redeemedCount: existingId ? this.coupons.get(existingId).redeemedCount : 0,
      perUserLimit: input.perUserLimit,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      metadata: input.metadata || {},
      createdByAdminUserId: input.createdByAdminUserId,
      createdAt: existingId ? this.coupons.get(existingId).createdAt : now,
      updatedAt: now
    });
    this.coupons.set(coupon.id, coupon);
    this.couponsByCode.set(coupon.code, coupon.id);
    return clone(coupon);
  }

  async findUserCoupon(userId, couponId) {
    const entry = Array.from(this.userCoupons.values()).find((coupon) => coupon.userId === userId && coupon.couponId === couponId);
    return entry ? this.withCoupon(entry) : null;
  }

  async findUserCouponById(userId, userCouponId) {
    const entry = this.userCoupons.get(userCouponId);
    return entry?.userId === userId ? this.withCoupon(entry) : null;
  }

  async grantCouponToUser(input) {
    const existing = Array.from(this.userCoupons.values()).find((entry) => entry.userId === input.userId && entry.couponId === input.couponId);
    if (existing) return null;
    const coupon = normalizeUserCoupon({
      id: randomUUID(),
      userId: input.userId,
      couponId: input.couponId,
      status: "available",
      redeemedSource: input.source || "code",
      redeemedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.userCoupons.set(coupon.id, coupon);
    return clone(coupon);
  }

  async incrementCouponRedeemedCount(couponId) {
    const coupon = this.coupons.get(couponId);
    if (!coupon) return null;
    coupon.redeemedCount += 1;
    coupon.updatedAt = new Date().toISOString();
    return clone(coupon);
  }

  async findWelcomeGiftClaim(userId) {
    return clone(this.welcomeClaims.get(userId));
  }

  async createWelcomeGiftClaim(userId, userCouponId) {
    if (this.welcomeClaims.has(userId)) return null;
    const claim = normalizeWelcomeGiftClaim({
      id: randomUUID(),
      userId,
      userCouponId,
      claimedAt: new Date().toISOString()
    });
    this.welcomeClaims.set(userId, claim);
    return clone(claim);
  }

  async findCheckoutParcel(userId, parcelId) {
    const parcel = this.shippingRepository?.parcels.get(parcelId);
    if (!parcel || parcel.userId !== userId) return null;
    const line = this.shippingRepository?.shippingLines.get(parcel.shippingLineId);
    return normalizeCheckoutParcel({
      id: parcel.id,
      userId: parcel.userId,
      status: parcel.status,
      shippingLineId: parcel.shippingLineId,
      shippingLineCode: line?.code || "",
      shippingLineName: line?.name || "",
      finalFeeCents: parcel.finalFeeCents,
      currency: parcel.currency,
      paidAt: parcel.paidAt
    });
  }

  async findActiveApplication(parcelId) {
    const app = Array.from(this.applications.values()).find((entry) => entry.parcelId === parcelId && ["locked", "applied"].includes(entry.status));
    return clone(app);
  }

  async lockCouponForParcel(input) {
    const userCoupon = this.userCoupons.get(input.userCouponId);
    if (!userCoupon || userCoupon.userId !== input.userId || userCoupon.status !== "available") return null;
    userCoupon.status = "locked";
    userCoupon.lockedParcelId = input.parcelId;
    userCoupon.discountCents = input.discountCents;
    userCoupon.lockedAt = new Date().toISOString();
    userCoupon.updatedAt = new Date().toISOString();

    const app = normalizeCheckoutCouponApplication({
      id: randomUUID(),
      userId: input.userId,
      parcelId: input.parcelId,
      userCouponId: input.userCouponId,
      couponId: input.couponId,
      status: "locked",
      discountCents: input.discountCents,
      originalFinalFeeCents: input.originalFinalFeeCents,
      finalFeeCents: input.finalFeeCents,
      createdAt: new Date().toISOString()
    });
    this.applications.set(app.id, app);
    const parcel = this.shippingRepository?.parcels.get(input.parcelId);
    if (parcel) {
      parcel.finalFeeCents = input.finalFeeCents;
      parcel.finalFee = input.finalFeeCents / 100;
    }
    return clone(app);
  }

  async settleCouponForParcel(parcelId) {
    const app = Array.from(this.applications.values()).find((entry) => entry.parcelId === parcelId && entry.status === "locked");
    if (!app) return null;
    app.status = "applied";
    app.appliedAt = app.appliedAt || new Date().toISOString();
    const userCoupon = this.userCoupons.get(app.userCouponId);
    if (userCoupon) {
      userCoupon.status = "used";
      userCoupon.usedParcelId = parcelId;
      userCoupon.usedAt = userCoupon.usedAt || new Date().toISOString();
      userCoupon.updatedAt = new Date().toISOString();
    }
    return clone(app);
  }

  async rollbackCouponForParcel(parcelId) {
    const app = Array.from(this.applications.values()).find((entry) => entry.parcelId === parcelId && entry.status === "locked");
    if (!app) return null;
    app.status = "rolled_back";
    app.rolledBackAt = app.rolledBackAt || new Date().toISOString();
    const userCoupon = this.userCoupons.get(app.userCouponId);
    if (userCoupon) {
      userCoupon.status = "available";
      userCoupon.lockedParcelId = null;
      userCoupon.discountCents = null;
      userCoupon.lockedAt = null;
      userCoupon.updatedAt = new Date().toISOString();
    }
    const parcel = this.shippingRepository?.parcels.get(parcelId);
    if (parcel) {
      parcel.finalFeeCents = app.originalFinalFeeCents;
      parcel.finalFee = app.originalFinalFeeCents / 100;
    }
    return clone(app);
  }

  async adjustWalletCredit(input) {
    const wallet = await this.ensureWallet(input.userId);
    const nextBalance = wallet.balanceCents + input.amountCents;
    if (nextBalance < 0) return null;
    wallet.balanceCents = nextBalance;
    wallet.balance = nextBalance / 100;
    wallet.updatedAt = new Date().toISOString();
    this.wallets.set(wallet.id, wallet);
    const transaction = normalizeWalletTransaction({
      id: randomUUID(),
      walletId: wallet.id,
      userId: input.userId,
      amountCents: input.amountCents,
      balanceAfterCents: nextBalance,
      currency: wallet.currency,
      reason: input.reason,
      sourceType: input.sourceType || "admin_adjustment",
      sourceId: input.sourceId || "",
      createdByAdminUserId: input.createdByAdminUserId,
      createdAt: new Date().toISOString()
    });
    this.transactions.set(transaction.id, transaction);
    return {
      wallet: clone(wallet),
      transaction: clone(transaction)
    };
  }

  withCoupon(userCoupon) {
    const coupon = this.coupons.get(userCoupon.couponId);
    return normalizeUserCouponWithCoupon({
      uc_id: userCoupon.id,
      uc_user_id: userCoupon.userId,
      uc_coupon_id: userCoupon.couponId,
      uc_status: userCoupon.status,
      uc_redeemed_source: userCoupon.redeemedSource,
      uc_discount_cents: userCoupon.discountCents,
      uc_locked_parcel_id: userCoupon.lockedParcelId,
      uc_used_parcel_id: userCoupon.usedParcelId,
      uc_redeemed_at: userCoupon.redeemedAt,
      uc_locked_at: userCoupon.lockedAt,
      uc_used_at: userCoupon.usedAt,
      uc_updated_at: userCoupon.updatedAt,
      ...coupon
    });
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
