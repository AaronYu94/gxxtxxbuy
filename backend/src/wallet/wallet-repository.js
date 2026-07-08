import { getDbPool } from "../db/pool.js";
import { centsToMoney } from "../core/core-input.js";

export function createPgWalletRepository(env) {
  return {
    async ensureWallet(userId) {
      const result = await getDbPool(env).query(
        `insert into wallets (user_id)
         values ($1)
         on conflict (user_id) do update set user_id = excluded.user_id
         returning *`,
        [userId]
      );
      return normalizeWallet(result.rows[0]);
    },

    async listWalletTransactions(userId, limit = 30) {
      const result = await getDbPool(env).query(
        `select * from wallet_transactions
         where user_id = $1
         order by created_at desc
         limit $2`,
        [userId, limit]
      );
      return result.rows.map(normalizeWalletTransaction);
    },

    async listUserCoupons(userId) {
      const result = await getDbPool(env).query(
        `select
           uc.id as uc_id,
           uc.user_id as uc_user_id,
           uc.coupon_id as uc_coupon_id,
           uc.status as uc_status,
           uc.redeemed_source as uc_redeemed_source,
           uc.discount_cents as uc_discount_cents,
           uc.locked_parcel_id as uc_locked_parcel_id,
           uc.used_parcel_id as uc_used_parcel_id,
           uc.redeemed_at as uc_redeemed_at,
           uc.locked_at as uc_locked_at,
           uc.used_at as uc_used_at,
           uc.updated_at as uc_updated_at,
           c.*
         from user_coupons uc
         join coupons c on c.id = uc.coupon_id
         where uc.user_id = $1
         order by uc.redeemed_at desc`,
        [userId]
      );
      return result.rows.map(normalizeUserCouponWithCoupon);
    },

    async findCouponByCode(code) {
      const result = await getDbPool(env).query("select * from coupons where code = $1 limit 1", [code]);
      return normalizeCoupon(result.rows[0]);
    },

    async findCouponById(couponId) {
      const result = await getDbPool(env).query("select * from coupons where id = $1 limit 1", [couponId]);
      return normalizeCoupon(result.rows[0]);
    },

    async upsertCoupon(input) {
      const result = await getDbPool(env).query(
        `insert into coupons (
          code,
          title,
          description,
          status,
          coupon_type,
          discount_type,
          amount_cents,
          percent_off,
          max_discount_cents,
          min_shipping_fee_cents,
          currency,
          eligible_shipping_line_codes,
          combinable,
          total_redemptions,
          per_user_limit,
          starts_at,
          expires_at,
          metadata,
          created_by_admin_user_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        on conflict (code) do update
        set title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            coupon_type = excluded.coupon_type,
            discount_type = excluded.discount_type,
            amount_cents = excluded.amount_cents,
            percent_off = excluded.percent_off,
            max_discount_cents = excluded.max_discount_cents,
            min_shipping_fee_cents = excluded.min_shipping_fee_cents,
            currency = excluded.currency,
            eligible_shipping_line_codes = excluded.eligible_shipping_line_codes,
            combinable = excluded.combinable,
            total_redemptions = excluded.total_redemptions,
            per_user_limit = excluded.per_user_limit,
            starts_at = excluded.starts_at,
            expires_at = excluded.expires_at,
            metadata = excluded.metadata
        returning *`,
        [
          input.code,
          input.title,
          input.description,
          input.status,
          input.couponType,
          input.discountType,
          input.amountCents,
          input.percentOff,
          input.maxDiscountCents,
          input.minShippingFeeCents,
          input.currency,
          JSON.stringify(input.eligibleShippingLineCodes || []),
          input.combinable,
          input.totalRedemptions,
          input.perUserLimit,
          input.startsAt || null,
          input.expiresAt || null,
          input.metadata || {},
          input.createdByAdminUserId || null
        ]
      );
      return normalizeCoupon(result.rows[0]);
    },

    async findUserCoupon(userId, couponId) {
      const result = await getDbPool(env).query(
        `select
           uc.id as uc_id,
           uc.user_id as uc_user_id,
           uc.coupon_id as uc_coupon_id,
           uc.status as uc_status,
           uc.redeemed_source as uc_redeemed_source,
           uc.discount_cents as uc_discount_cents,
           uc.locked_parcel_id as uc_locked_parcel_id,
           uc.used_parcel_id as uc_used_parcel_id,
           uc.redeemed_at as uc_redeemed_at,
           uc.locked_at as uc_locked_at,
           uc.used_at as uc_used_at,
           uc.updated_at as uc_updated_at,
           c.*
         from user_coupons uc
         join coupons c on c.id = uc.coupon_id
         where uc.user_id = $1 and uc.coupon_id = $2
         limit 1`,
        [userId, couponId]
      );
      return normalizeUserCouponWithCoupon(result.rows[0]);
    },

    async findUserCouponById(userId, userCouponId) {
      const result = await getDbPool(env).query(
        `select
           uc.id as uc_id,
           uc.user_id as uc_user_id,
           uc.coupon_id as uc_coupon_id,
           uc.status as uc_status,
           uc.redeemed_source as uc_redeemed_source,
           uc.discount_cents as uc_discount_cents,
           uc.locked_parcel_id as uc_locked_parcel_id,
           uc.used_parcel_id as uc_used_parcel_id,
           uc.redeemed_at as uc_redeemed_at,
           uc.locked_at as uc_locked_at,
           uc.used_at as uc_used_at,
           uc.updated_at as uc_updated_at,
           c.*
         from user_coupons uc
         join coupons c on c.id = uc.coupon_id
         where uc.user_id = $1 and uc.id = $2
         limit 1`,
        [userId, userCouponId]
      );
      return normalizeUserCouponWithCoupon(result.rows[0]);
    },

    async grantCouponToUser(input) {
      const result = await getDbPool(env).query(
        `insert into user_coupons (user_id, coupon_id, status, redeemed_source)
         values ($1, $2, 'available', $3)
         on conflict (user_id, coupon_id) do nothing
         returning *`,
        [input.userId, input.couponId, input.source || "code"]
      );
      if (!result.rows[0]) {
        return null;
      }
      return normalizeUserCoupon(result.rows[0]);
    },

    async incrementCouponRedeemedCount(couponId) {
      const result = await getDbPool(env).query(
        `update coupons
         set redeemed_count = redeemed_count + 1
         where id = $1
         returning *`,
        [couponId]
      );
      return normalizeCoupon(result.rows[0]);
    },

    async findWelcomeGiftClaim(userId) {
      const result = await getDbPool(env).query(
        "select * from welcome_gift_claims where user_id = $1 limit 1",
        [userId]
      );
      return normalizeWelcomeGiftClaim(result.rows[0]);
    },

    async createWelcomeGiftClaim(userId, userCouponId) {
      const result = await getDbPool(env).query(
        `insert into welcome_gift_claims (user_id, user_coupon_id)
         values ($1, $2)
         on conflict (user_id) do nothing
         returning *`,
        [userId, userCouponId || null]
      );
      return normalizeWelcomeGiftClaim(result.rows[0]);
    },

    async findCheckoutParcel(userId, parcelId) {
      const result = await getDbPool(env).query(
        `select
           p.*,
           sl.code as shipping_line_code,
           sl.name as shipping_line_name
         from parcels p
         left join shipping_lines sl on sl.id = p.shipping_line_id
         where p.user_id = $1 and p.id = $2
         limit 1`,
        [userId, parcelId]
      );
      return normalizeCheckoutParcel(result.rows[0]);
    },

    async findActiveApplication(parcelId) {
      const result = await getDbPool(env).query(
        `select * from checkout_coupon_applications
         where parcel_id = $1 and status in ('locked', 'applied')
         limit 1`,
        [parcelId]
      );
      return normalizeCheckoutCouponApplication(result.rows[0]);
    },

    async lockCouponForParcel(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const userCouponResult = await client.query(
          `update user_coupons
           set status = 'locked',
               locked_parcel_id = $3,
               discount_cents = $4,
               locked_at = now()
           where id = $1 and user_id = $2 and status = 'available'
           returning *`,
          [input.userCouponId, input.userId, input.parcelId, input.discountCents]
        );
        if (!userCouponResult.rows[0]) {
          await client.query("rollback");
          return null;
        }
        const applicationResult = await client.query(
          `insert into checkout_coupon_applications (
            user_id,
            parcel_id,
            user_coupon_id,
            coupon_id,
            status,
            discount_cents,
            original_final_fee_cents,
            final_fee_cents
          ) values ($1, $2, $3, $4, 'locked', $5, $6, $7)
          returning *`,
          [
            input.userId,
            input.parcelId,
            input.userCouponId,
            input.couponId,
            input.discountCents,
            input.originalFinalFeeCents,
            input.finalFeeCents
          ]
        );
        await client.query(
          "update parcels set final_fee_cents = $3 where user_id = $1 and id = $2",
          [input.userId, input.parcelId, input.finalFeeCents]
        );
        await client.query("commit");
        return normalizeCheckoutCouponApplication(applicationResult.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async settleCouponForParcel(parcelId) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const appResult = await client.query(
          `update checkout_coupon_applications
           set status = 'applied',
               applied_at = coalesce(applied_at, now())
           where parcel_id = $1 and status = 'locked'
           returning *`,
          [parcelId]
        );
        const application = normalizeCheckoutCouponApplication(appResult.rows[0]);
        if (application) {
          await client.query(
            `update user_coupons
             set status = 'used',
                 used_parcel_id = $2,
                 used_at = coalesce(used_at, now())
             where id = $1`,
            [application.userCouponId, parcelId]
          );
        }
        await client.query("commit");
        return application;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async rollbackCouponForParcel(parcelId) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const appResult = await client.query(
          `update checkout_coupon_applications
           set status = 'rolled_back',
               rolled_back_at = coalesce(rolled_back_at, now())
           where parcel_id = $1 and status = 'locked'
           returning *`,
          [parcelId]
        );
        const application = normalizeCheckoutCouponApplication(appResult.rows[0]);
        if (application) {
          await client.query(
            `update user_coupons
             set status = 'available',
                 locked_parcel_id = null,
                 discount_cents = null,
                 locked_at = null
             where id = $1`,
            [application.userCouponId]
          );
          await client.query(
            "update parcels set final_fee_cents = $2 where id = $1",
            [parcelId, application.originalFinalFeeCents]
          );
        }
        await client.query("commit");
        return application;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async adjustWalletCredit(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const walletResult = await client.query(
          `insert into wallets (user_id)
           values ($1)
           on conflict (user_id) do update set user_id = excluded.user_id
           returning *`,
          [input.userId]
        );
        const wallet = normalizeWallet(walletResult.rows[0]);
        const nextBalance = wallet.balanceCents + input.amountCents;
        if (nextBalance < 0) {
          await client.query("rollback");
          return null;
        }
        const updatedWalletResult = await client.query(
          `update wallets
           set balance_cents = $2
           where id = $1
           returning *`,
          [wallet.id, nextBalance]
        );
        const transactionResult = await client.query(
          `insert into wallet_transactions (
            wallet_id,
            user_id,
            amount_cents,
            balance_after_cents,
            currency,
            reason,
            source_type,
            source_id,
            created_by_admin_user_id
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          returning *`,
          [
            wallet.id,
            input.userId,
            input.amountCents,
            nextBalance,
            wallet.currency,
            input.reason,
            input.sourceType || "admin_adjustment",
            input.sourceId || "",
            input.createdByAdminUserId || null
          ]
        );
        await client.query("commit");
        return {
          wallet: normalizeWallet(updatedWalletResult.rows[0]),
          transaction: normalizeWalletTransaction(transactionResult.rows[0])
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeWallet(row) {
  if (!row) return null;
  const balanceCents = Number(row.balance_cents ?? row.balanceCents ?? 0);
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    balanceCents: Number.isFinite(balanceCents) ? balanceCents : 0,
    balance: centsToMoney(Number.isFinite(balanceCents) ? balanceCents : 0),
    currency: row.currency || "USD",
    status: row.status || "active",
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeWalletTransaction(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    walletId: String(row.wallet_id ?? row.walletId),
    userId: String(row.user_id ?? row.userId),
    amountCents: Number(row.amount_cents ?? row.amountCents),
    amount: centsToMoney(row.amount_cents ?? row.amountCents),
    balanceAfterCents: Number(row.balance_after_cents ?? row.balanceAfterCents),
    balanceAfter: centsToMoney(row.balance_after_cents ?? row.balanceAfterCents),
    currency: row.currency || "USD",
    reason: row.reason || "",
    sourceType: row.source_type ?? row.sourceType ?? "",
    sourceId: row.source_id ?? row.sourceId ?? "",
    createdByAdminUserId: row.created_by_admin_user_id ? String(row.created_by_admin_user_id) : row.createdByAdminUserId || null,
    createdAt: toIso(row.created_at ?? row.createdAt)
  };
}

export function normalizeCoupon(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    code: row.code,
    title: row.title,
    description: row.description || "",
    status: row.status || "active",
    couponType: row.coupon_type ?? row.couponType ?? "shipping",
    discountType: row.discount_type ?? row.discountType ?? "fixed",
    amountCents: nullableNumber(row.amount_cents ?? row.amountCents),
    amount: centsToMoney(row.amount_cents ?? row.amountCents),
    percentOff: nullableNumber(row.percent_off ?? row.percentOff),
    maxDiscountCents: nullableNumber(row.max_discount_cents ?? row.maxDiscountCents),
    minShippingFeeCents: Number(row.min_shipping_fee_cents ?? row.minShippingFeeCents ?? 0),
    currency: row.currency || "USD",
    eligibleShippingLineCodes: normalizeJsonArray(row.eligible_shipping_line_codes ?? row.eligibleShippingLineCodes),
    combinable: Boolean(row.combinable),
    totalRedemptions: nullableNumber(row.total_redemptions ?? row.totalRedemptions),
    redeemedCount: Number(row.redeemed_count ?? row.redeemedCount ?? 0),
    perUserLimit: Number(row.per_user_limit ?? row.perUserLimit ?? 1),
    startsAt: toIso(row.starts_at ?? row.startsAt),
    expiresAt: toIso(row.expires_at ?? row.expiresAt),
    metadata: row.metadata || {},
    createdByAdminUserId: row.created_by_admin_user_id ? String(row.created_by_admin_user_id) : row.createdByAdminUserId || null,
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt)
  };
}

export function normalizeUserCoupon(row) {
  if (!row) return null;
  return {
    id: String(row.uc_id ?? row.id),
    userId: String(row.uc_user_id ?? row.user_id ?? row.userId),
    couponId: String(row.uc_coupon_id ?? row.coupon_id ?? row.couponId),
    status: row.uc_status ?? row.status ?? "available",
    redeemedSource: row.uc_redeemed_source ?? row.redeemed_source ?? row.redeemedSource ?? "code",
    discountCents: nullableNumber(row.uc_discount_cents ?? row.discount_cents ?? row.discountCents),
    lockedParcelId: row.uc_locked_parcel_id ? String(row.uc_locked_parcel_id) : row.locked_parcel_id ? String(row.locked_parcel_id) : row.lockedParcelId || null,
    usedParcelId: row.uc_used_parcel_id ? String(row.uc_used_parcel_id) : row.used_parcel_id ? String(row.used_parcel_id) : row.usedParcelId || null,
    redeemedAt: toIso(row.uc_redeemed_at ?? row.redeemed_at ?? row.redeemedAt),
    lockedAt: toIso(row.uc_locked_at ?? row.locked_at ?? row.lockedAt),
    usedAt: toIso(row.uc_used_at ?? row.used_at ?? row.usedAt),
    updatedAt: toIso(row.uc_updated_at ?? row.updated_at ?? row.updatedAt)
  };
}

export function normalizeUserCouponWithCoupon(row) {
  if (!row) return null;
  const userCoupon = normalizeUserCoupon(row);
  return {
    ...userCoupon,
    coupon: normalizeCoupon(row)
  };
}

export function normalizeWelcomeGiftClaim(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    userCouponId: row.user_coupon_id ? String(row.user_coupon_id) : row.userCouponId || null,
    claimedAt: toIso(row.claimed_at ?? row.claimedAt)
  };
}

export function normalizeCheckoutParcel(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    status: row.status,
    shippingLineId: row.shipping_line_id ? String(row.shipping_line_id) : row.shippingLineId || null,
    shippingLineCode: row.shipping_line_code ?? row.shippingLineCode ?? "",
    shippingLineName: row.shipping_line_name ?? row.shippingLineName ?? "",
    finalFeeCents: nullableNumber(row.final_fee_cents ?? row.finalFeeCents),
    currency: row.currency || "USD",
    paidAt: toIso(row.paid_at ?? row.paidAt)
  };
}

export function normalizeCheckoutCouponApplication(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    parcelId: String(row.parcel_id ?? row.parcelId),
    userCouponId: String(row.user_coupon_id ?? row.userCouponId),
    couponId: String(row.coupon_id ?? row.couponId),
    status: row.status,
    discountCents: Number(row.discount_cents ?? row.discountCents),
    discount: centsToMoney(row.discount_cents ?? row.discountCents),
    originalFinalFeeCents: Number(row.original_final_fee_cents ?? row.originalFinalFeeCents),
    finalFeeCents: Number(row.final_fee_cents ?? row.finalFeeCents),
    finalFee: centsToMoney(row.final_fee_cents ?? row.finalFeeCents),
    createdAt: toIso(row.created_at ?? row.createdAt),
    appliedAt: toIso(row.applied_at ?? row.appliedAt),
    rolledBackAt: toIso(row.rolled_back_at ?? row.rolledBackAt)
  };
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
