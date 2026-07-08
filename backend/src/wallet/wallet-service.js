import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { evaluateCouponEligibility } from "./coupon-eligibility.js";

export function createWalletService({
  repository,
  env,
  auditLogger = null,
  clock = () => new Date()
} = {}) {
  if (!repository) throw new Error("Wallet repository is required.");
  if (!env) throw new Error("Wallet service env is required.");

  return {
    async getWallet(user) {
      const wallet = await repository.ensureWallet(user.id);
      const [transactions, coupons] = await Promise.all([
        repository.listWalletTransactions(user.id),
        repository.listUserCoupons(user.id)
      ]);
      return {
        wallet: publicWallet(wallet),
        transactions: transactions.map(publicWalletTransaction),
        coupons: coupons.map(publicUserCoupon)
      };
    },

    async redeemCode(user, input = {}, requestMeta = {}) {
      const code = normalizeCode(input.code);
      const coupon = await repository.findCouponByCode(code);
      validateCouponRedeemable(coupon, clock());

      const existing = await repository.findUserCoupon(user.id, coupon.id);
      if (existing) {
        throw conflict("Coupon already redeemed.", { code: "COUPON_DUPLICATE" });
      }
      if (coupon.totalRedemptions !== null && coupon.redeemedCount >= coupon.totalRedemptions) {
        throw conflict("Coupon redemption limit reached.", { code: "COUPON_LIMIT_REACHED" });
      }

      const userCoupon = await repository.grantCouponToUser({
        userId: user.id,
        couponId: coupon.id,
        source: "code"
      });
      if (!userCoupon) {
        throw conflict("Coupon already redeemed.", { code: "COUPON_DUPLICATE" });
      }
      await repository.incrementCouponRedeemedCount(coupon.id);
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "coupon.redeem_code",
        resourceType: "coupon",
        resourceId: coupon.id,
        metadata: { code: coupon.code },
        requestId: requestMeta.requestId
      }, { critical: false });
      return {
        user_coupon: publicUserCoupon({ ...userCoupon, coupon }),
        existing: false
      };
    },

    async claimWelcomeGift(user, requestMeta = {}) {
      if (!env.welcomeGiftEnabled) {
        throw conflict("Welcome Gift is currently disabled.", { code: "WELCOME_GIFT_DISABLED" });
      }
      const existingClaim = await repository.findWelcomeGiftClaim(user.id);
      if (existingClaim) {
        const coupons = await repository.listUserCoupons(user.id);
        const userCoupon = coupons.find((entry) => entry.id === existingClaim.userCouponId) || null;
        return {
          claim: publicWelcomeGiftClaim(existingClaim),
          user_coupon: userCoupon ? publicUserCoupon(userCoupon) : null,
          existing: true
        };
      }

      const coupon = await repository.upsertCoupon(defaultWelcomeGiftCoupon(env));
      const existingCoupon = await repository.findUserCoupon(user.id, coupon.id);
      const userCoupon = existingCoupon || await repository.grantCouponToUser({
        userId: user.id,
        couponId: coupon.id,
        source: "welcome_gift"
      });
      if (!existingCoupon) {
        await repository.incrementCouponRedeemedCount(coupon.id);
      }
      const claim = await repository.createWelcomeGiftClaim(user.id, userCoupon?.id || existingCoupon?.id);
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "welcome_gift.claim",
        resourceType: "coupon",
        resourceId: coupon.id,
        metadata: { code: coupon.code },
        requestId: requestMeta.requestId
      }, { critical: false });
      return {
        claim: publicWelcomeGiftClaim(claim),
        user_coupon: publicUserCoupon({ ...(userCoupon || existingCoupon), coupon }),
        existing: false
      };
    },

    async applyCoupon(user, input = {}, requestMeta = {}) {
      const parcelId = requiredText(input.parcel_id ?? input.parcelId, "parcel_id", 80);
      const userCouponId = requiredText(input.user_coupon_id ?? input.userCouponId, "user_coupon_id", 80);
      const [userCoupon, parcel, activeApplication] = await Promise.all([
        repository.findUserCouponById(user.id, userCouponId),
        repository.findCheckoutParcel(user.id, parcelId),
        repository.findActiveApplication(parcelId)
      ]);
      if (!userCoupon) throw notFound("Coupon not found.");
      if (!parcel) throw notFound("Parcel not found.");
      if (activeApplication?.userCouponId === userCoupon.id) {
        return {
          application: publicCouponApplication(activeApplication),
          user_coupon: publicUserCoupon(userCoupon),
          existing: true
        };
      }

      if (userCoupon.coupon.couponType !== "shipping") {
        throw conflict("Coupon cannot be applied to shipping checkout.", { code: "COUPON_TYPE_NOT_SHIPPING" });
      }

      const eligibility = evaluateCouponEligibility({
        coupon: userCoupon.coupon,
        userCoupon,
        parcel,
        activeApplication,
        now: clock()
      });
      if (!eligibility.eligible) {
        throw conflict("Coupon is not eligible for this checkout.", { reasons: eligibility.reasons });
      }

      const application = await repository.lockCouponForParcel({
        userId: user.id,
        parcelId: parcel.id,
        userCouponId: userCoupon.id,
        couponId: userCoupon.coupon.id,
        discountCents: eligibility.discountCents,
        originalFinalFeeCents: parcel.finalFeeCents,
        finalFeeCents: eligibility.finalFeeCents
      });
      if (!application) {
        throw conflict("Coupon is no longer available.", { code: "COUPON_NOT_AVAILABLE" });
      }
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "coupon.apply",
        resourceType: "parcel",
        resourceId: parcel.id,
        metadata: { coupon_id: userCoupon.coupon.id, discount_cents: application.discountCents },
        requestId: requestMeta.requestId
      }, { critical: false });
      return {
        application: publicCouponApplication(application),
        user_coupon: publicUserCoupon({ ...userCoupon, status: "locked", discountCents: application.discountCents }),
        existing: false
      };
    },

    async syncCouponForPayment(payment) {
      if (!payment?.parcelId) return null;
      if (payment.status === "succeeded") {
        return repository.settleCouponForParcel(payment.parcelId);
      }
      if (["failed", "cancelled"].includes(payment.status)) {
        return repository.rollbackCouponForParcel(payment.parcelId);
      }
      return null;
    },

    async createAdminCoupon(adminUser, input = {}, requestMeta = {}) {
      const coupon = await repository.upsertCoupon(parseCouponInput(input, adminUser.id));
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "coupon.admin.upsert",
        resourceType: "coupon",
        resourceId: coupon.id,
        metadata: { code: coupon.code, status: coupon.status },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { coupon: publicCoupon(coupon) };
    },

    async adjustWalletCredit(adminUser, userId, input = {}, requestMeta = {}) {
      const amountCents = parseAmountCents(input);
      const reason = requiredText(input.reason, "reason", 500);
      const result = await repository.adjustWalletCredit({
        userId,
        amountCents,
        reason,
        sourceType: "admin_adjustment",
        sourceId: requestMeta.requestId || "",
        createdByAdminUserId: adminUser.id
      });
      if (!result) {
        throw conflict("Wallet balance cannot go below zero.", { code: "INSUFFICIENT_WALLET_BALANCE" });
      }
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "wallet.credit.adjust",
        resourceType: "wallet",
        resourceId: result.wallet.id,
        metadata: { user_id: userId, amount_cents: amountCents, reason },
        requestId: requestMeta.requestId
      }, { critical: true });
      return {
        wallet: publicWallet(result.wallet),
        transaction: publicWalletTransaction(result.transaction)
      };
    }
  };
}

export function publicWallet(wallet) {
  return {
    id: wallet.id,
    balance_cents: wallet.balanceCents,
    balance: wallet.balance,
    currency: wallet.currency,
    status: wallet.status,
    created_at: wallet.createdAt,
    updated_at: wallet.updatedAt
  };
}

export function publicWalletTransaction(transaction) {
  return {
    id: transaction.id,
    amount_cents: transaction.amountCents,
    amount: transaction.amount,
    balance_after_cents: transaction.balanceAfterCents,
    balance_after: transaction.balanceAfter,
    currency: transaction.currency,
    reason: transaction.reason,
    source_type: transaction.sourceType,
    source_id: transaction.sourceId,
    created_at: transaction.createdAt
  };
}

export function publicCoupon(coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    title: coupon.title,
    description: coupon.description,
    status: coupon.status,
    coupon_type: coupon.couponType,
    discount_type: coupon.discountType,
    amount_cents: coupon.amountCents,
    amount: coupon.amount,
    percent_off: coupon.percentOff,
    max_discount_cents: coupon.maxDiscountCents,
    min_shipping_fee_cents: coupon.minShippingFeeCents,
    currency: coupon.currency,
    eligible_shipping_line_codes: coupon.eligibleShippingLineCodes,
    combinable: coupon.combinable,
    total_redemptions: coupon.totalRedemptions,
    redeemed_count: coupon.redeemedCount,
    per_user_limit: coupon.perUserLimit,
    starts_at: coupon.startsAt,
    expires_at: coupon.expiresAt,
    metadata: coupon.metadata,
    created_at: coupon.createdAt,
    updated_at: coupon.updatedAt
  };
}

export function publicUserCoupon(userCoupon) {
  return {
    id: userCoupon.id,
    status: userCoupon.status,
    redeemed_source: userCoupon.redeemedSource,
    discount_cents: userCoupon.discountCents,
    locked_parcel_id: userCoupon.lockedParcelId,
    used_parcel_id: userCoupon.usedParcelId,
    redeemed_at: userCoupon.redeemedAt,
    locked_at: userCoupon.lockedAt,
    used_at: userCoupon.usedAt,
    coupon: publicCoupon(userCoupon.coupon)
  };
}

export function publicCouponApplication(application) {
  return {
    id: application.id,
    parcel_id: application.parcelId,
    user_coupon_id: application.userCouponId,
    coupon_id: application.couponId,
    status: application.status,
    discount_cents: application.discountCents,
    discount: application.discount,
    original_final_fee_cents: application.originalFinalFeeCents,
    final_fee_cents: application.finalFeeCents,
    final_fee: application.finalFee,
    created_at: application.createdAt,
    applied_at: application.appliedAt,
    rolled_back_at: application.rolledBackAt
  };
}

function publicWelcomeGiftClaim(claim) {
  return {
    id: claim.id,
    user_coupon_id: claim.userCouponId,
    claimed_at: claim.claimedAt
  };
}

function validateCouponRedeemable(coupon, now) {
  if (!coupon) throw notFound("Coupon code not found.");
  if (coupon.status !== "active") throw conflict("Coupon is not active.", { code: "COUPON_INACTIVE" });
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now.getTime()) {
    throw conflict("Coupon is not active yet.", { code: "COUPON_NOT_STARTED" });
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now.getTime()) {
    throw conflict("Coupon has expired.", { code: "COUPON_EXPIRED" });
  }
}

function defaultWelcomeGiftCoupon(env) {
  return {
    code: normalizeCode(env.welcomeGiftCode),
    title: "Welcome Gift",
    description: "New user shipping coupon.",
    status: "active",
    couponType: "shipping",
    discountType: "fixed",
    amountCents: env.welcomeGiftAmountCents,
    percentOff: null,
    maxDiscountCents: null,
    minShippingFeeCents: 0,
    currency: "USD",
    eligibleShippingLineCodes: [],
    combinable: false,
    totalRedemptions: null,
    perUserLimit: 1,
    startsAt: null,
    expiresAt: null,
    metadata: { system: "welcome_gift" },
    createdByAdminUserId: null
  };
}

function parseCouponInput(input, adminUserId) {
  const discountType = optionalText(input.discount_type ?? input.discountType, "discount_type", 20) || "fixed";
  if (!["fixed", "percent", "credit"].includes(discountType)) {
    throw badRequest("discount_type is invalid.", { field: "discount_type" });
  }
  const couponType = optionalText(input.coupon_type ?? input.couponType, "coupon_type", 30) || "shipping";
  if (!["shipping", "wallet_credit", "welcome"].includes(couponType)) {
    throw badRequest("coupon_type is invalid.", { field: "coupon_type" });
  }
  const amountCents = parseCouponAmountCents(input);
  const percentOff = input.percent_off === undefined && input.percentOff === undefined
    ? null
    : Number(input.percent_off ?? input.percentOff);
  if (discountType === "fixed" && (!amountCents || amountCents <= 0)) {
    throw badRequest("amount is required for fixed coupons.", { field: "amount" });
  }
  if (discountType === "percent" && (!Number.isInteger(percentOff) || percentOff <= 0 || percentOff > 100)) {
    throw badRequest("percent_off must be 1-100.", { field: "percent_off" });
  }
  const status = optionalText(input.status, "status", 20) || "active";
  if (!["active", "disabled", "archived"].includes(status)) {
    throw badRequest("status is invalid.", { field: "status" });
  }

  return {
    code: normalizeCode(input.code),
    title: requiredText(input.title || input.code, "title", 160),
    description: optionalText(input.description, "description", 500),
    status,
    couponType,
    discountType,
    amountCents,
    percentOff: discountType === "percent" ? percentOff : null,
    maxDiscountCents: parseOptionalCents(input.max_discount_cents ?? input.maxDiscountCents, "max_discount_cents"),
    minShippingFeeCents: parseOptionalCents(input.min_shipping_fee_cents ?? input.minShippingFeeCents, "min_shipping_fee_cents") || 0,
    currency: optionalText(input.currency, "currency", 3) || "USD",
    eligibleShippingLineCodes: normalizeCodeList(input.eligible_shipping_line_codes ?? input.eligibleShippingLineCodes),
    combinable: Boolean(input.combinable),
    totalRedemptions: optionalInteger(input.total_redemptions ?? input.totalRedemptions, "total_redemptions"),
    perUserLimit: optionalInteger(input.per_user_limit ?? input.perUserLimit, "per_user_limit") || 1,
    startsAt: input.starts_at || input.startsAt || null,
    expiresAt: input.expires_at || input.expiresAt || null,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {},
    createdByAdminUserId: adminUserId
  };
}

function normalizeCode(value) {
  const code = requiredText(value, "code", 80).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(code)) {
    throw badRequest("code must contain only letters, numbers, underscore, or dash.", { field: "code" });
  }
  return code;
}

function normalizeCodeList(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw badRequest("eligible_shipping_line_codes must be an array.", { field: "eligible_shipping_line_codes" });
  return value.map((entry) => normalizeCode(entry));
}

function parseAmountCents(input) {
  const value = input.amount_cents ?? input.amountCents;
  if (value !== undefined && value !== null && value !== "") {
    const cents = Number(value);
    if (!Number.isInteger(cents) || cents === 0) throw badRequest("amount_cents must be a non-zero integer.", { field: "amount_cents" });
    return cents;
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) throw badRequest("amount is required.", { field: "amount" });
  return Math.round(amount * 100);
}

function parseOptionalCents(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw badRequest(`${field} must be non-negative.`, { field });
  return Number.isInteger(number) ? number : Math.round(number * 100);
}

function parseCouponAmountCents(input) {
  if (input.amount_cents !== undefined || input.amountCents !== undefined) {
    const cents = Number(input.amount_cents ?? input.amountCents);
    if (!Number.isInteger(cents) || cents < 0) throw badRequest("amount_cents must be a non-negative integer.", { field: "amount_cents" });
    return cents;
  }
  if (input.amount === undefined || input.amount === null || input.amount === "") return null;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw badRequest("amount must be non-negative.", { field: "amount" });
  return Math.round(amount * 100);
}

function optionalInteger(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw badRequest(`${field} must be a positive integer.`, { field });
  return number;
}
