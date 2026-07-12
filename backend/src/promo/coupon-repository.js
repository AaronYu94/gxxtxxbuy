import { getDbPool } from "../db/pool.js";

// V2-10-01/02/03/04 — international-shipping coupons (definition, grants, reservation).
export function createPgCouponRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- definition ----
    async createCoupon(def) {
      try {
        const r = await pool().query(
          `insert into promo_coupons (code, name, discount_type, fixed_value_minor, percent_bps, threshold_min_minor,
             threshold_discount_minor, max_discount_minor, eligible_countries, eligible_route_codes, total_quota,
             per_user_limit, claim_starts_at, claim_ends_at, use_starts_at, use_ends_at, status, created_by_admin_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17) returning *`,
          [def.code, def.name || "", def.discountType, def.fixedValueMinor || 0, def.percentBps || 0, def.thresholdMinMinor || 0,
           def.thresholdDiscountMinor || 0, def.maxDiscountMinor || 0, JSON.stringify(def.eligibleCountries || []), JSON.stringify(def.eligibleRouteCodes || []),
           def.totalQuota ?? null, def.perUserLimit || 1, def.claimStartsAt || null, def.claimEndsAt || null, def.useStartsAt || null, def.useEndsAt || null, def.adminId || null]
        );
        return normalizeCoupon(r.rows[0]);
      } catch (e) { if (e.code === "23505") { const err = new Error("dup"); err.code = "COUPON_EXISTS"; throw err; } throw e; }
    },
    async findByCode(code) { const r = await pool().query("select * from promo_coupons where code = $1", [code]); return normalizeCoupon(r.rows[0]); },
    async findById(id) { const r = await pool().query("select * from promo_coupons where id = $1", [id]); return normalizeCoupon(r.rows[0]); },
    async listCoupons() { return (await pool().query("select * from promo_coupons order by created_at desc")).rows.map(normalizeCoupon); },
    async setStatus(id, status) { const r = await pool().query("update promo_coupons set status = $2, version = version + 1 where id = $1 returning *", [id, status]); return normalizeCoupon(r.rows[0]); },
    async updateMutable(id, patch) {
      // Only non-frozen fields (quota, per-user limit, windows, name).
      const r = await pool().query(
        `update promo_coupons set name = coalesce($2, name), total_quota = coalesce($3, total_quota),
           per_user_limit = coalesce($4, per_user_limit), claim_ends_at = coalesce($5, claim_ends_at),
           use_ends_at = coalesce($6, use_ends_at), version = version + 1 where id = $1 returning *`,
        [id, patch.name ?? null, patch.totalQuota ?? null, patch.perUserLimit ?? null, patch.claimEndsAt ?? null, patch.useEndsAt ?? null]
      );
      return normalizeCoupon(r.rows[0]);
    },

    // ---- V2-10-03 grant (quota + per-user atomic, idempotent) ----
    async grant({ couponId, userId, source, idempotencyKey }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        // Idempotent replay guard.
        if (idempotencyKey) {
          const existing = (await client.query("select * from promo_coupon_grants where idempotency_key = $1", [idempotencyKey])).rows[0];
          if (existing) { await client.query("rollback"); return { grant: normalizeGrant(existing), created: false }; }
        }
        const coupon = (await client.query("select * from promo_coupons where id = $1 for update", [couponId])).rows[0];
        if (!coupon) { await client.query("rollback"); const e = new Error("no_coupon"); e.code = "COUPON_NOT_FOUND"; throw e; }
        if (coupon.status !== "active") { await client.query("rollback"); const e = new Error("inactive"); e.code = "COUPON_INACTIVE"; throw e; }
        if (coupon.total_quota != null && coupon.granted_count >= coupon.total_quota) { await client.query("rollback"); const e = new Error("quota"); e.code = "QUOTA_EXHAUSTED"; throw e; }
        const held = (await client.query("select count(*)::int c from promo_coupon_grants where coupon_id = $1 and user_id = $2 and status <> 'revoked'", [couponId, userId])).rows[0].c;
        if (held >= coupon.per_user_limit) { await client.query("rollback"); const e = new Error("per_user"); e.code = "PER_USER_LIMIT"; throw e; }
        await client.query("update promo_coupons set granted_count = granted_count + 1 where id = $1", [couponId]);
        let grant;
        try {
          grant = (await client.query(
            "insert into promo_coupon_grants (coupon_id, user_id, source, status, idempotency_key) values ($1, $2, $3, 'available', $4) returning *",
            [couponId, userId, source || "grant", idempotencyKey || null]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); const raced = (await pool().query("select * from promo_coupon_grants where idempotency_key = $1", [idempotencyKey])).rows[0]; return { grant: normalizeGrant(raced), created: false }; }
          throw error;
        }
        await client.query("commit");
        return { grant: normalizeGrant(grant), created: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listUserGrants(userId, { status = null } = {}) {
      const r = await pool().query(
        `select g.*, c.code coupon_code, c.discount_type, c.status coupon_status from promo_coupon_grants g
           join promo_coupons c on c.id = g.coupon_id
           where g.user_id = $1 and ($2::text is null or g.status = $2) order by g.created_at desc`,
        [userId, status]
      );
      return r.rows.map(normalizeGrantJoined);
    },
    async findGrantForUserCoupon(userId, couponId) {
      const r = await pool().query(
        "select * from promo_coupon_grants where user_id = $1 and coupon_id = $2 and status = 'available' order by created_at asc limit 1",
        [userId, couponId]
      );
      return normalizeGrant(r.rows[0]);
    },

    // ---- V2-10-04 reserve / settle / release ----
    async reserve({ grantId, parcelId, discountMinor }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const grant = (await client.query("select * from promo_coupon_grants where id = $1 for update", [grantId])).rows[0];
        if (!grant) { await client.query("rollback"); return { notFound: true }; }
        if (grant.status !== "available") { await client.query("rollback"); return { conflict: true, status: grant.status }; }
        let updated;
        try {
          updated = (await client.query(
            "update promo_coupon_grants set status = 'reserved', reserved_parcel_id = $2, discount_minor = $3 where id = $1 returning *",
            [grantId, parcelId, discountMinor || 0]
          )).rows[0];
        } catch (error) {
          if (error.code === "23505") { await client.query("rollback"); return { parcelTaken: true }; } // another coupon already reserved for this parcel
          throw error;
        }
        await client.query("commit");
        return { grant: normalizeGrant(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async settleForParcel(parcelId) {
      const r = await pool().query(
        "update promo_coupon_grants set status = 'used', used_parcel_id = reserved_parcel_id, reserved_parcel_id = null where reserved_parcel_id = $1 and status = 'reserved' returning *",
        [parcelId]
      );
      return r.rows.map(normalizeGrant);
    },
    async releaseForParcel(parcelId) {
      const r = await pool().query(
        "update promo_coupon_grants set status = 'available', reserved_parcel_id = null, discount_minor = 0 where reserved_parcel_id = $1 and status = 'reserved' returning *",
        [parcelId]
      );
      return r.rows.map(normalizeGrant);
    },
    async findReservedForParcel(parcelId) {
      const r = await pool().query("select * from promo_coupon_grants where reserved_parcel_id = $1 and status = 'reserved'", [parcelId]);
      return normalizeGrant(r.rows[0]);
    }
  };
}

export function normalizeCoupon(row) {
  if (!row) return null;
  return {
    id: row.id, code: row.code, name: row.name, discountType: row.discount_type, fixedValueMinor: Number(row.fixed_value_minor),
    percentBps: row.percent_bps, thresholdMinMinor: Number(row.threshold_min_minor), thresholdDiscountMinor: Number(row.threshold_discount_minor),
    maxDiscountMinor: Number(row.max_discount_minor), eligibleCountries: row.eligible_countries || [], eligibleRouteCodes: row.eligible_route_codes || [],
    totalQuota: row.total_quota, grantedCount: row.granted_count, perUserLimit: row.per_user_limit,
    claimStartsAt: row.claim_starts_at, claimEndsAt: row.claim_ends_at, useStartsAt: row.use_starts_at, useEndsAt: row.use_ends_at,
    status: row.status, version: row.version, createdAt: row.created_at
  };
}
export function normalizeGrant(row) {
  if (!row) return null;
  return { id: row.id, couponId: row.coupon_id, userId: row.user_id, source: row.source, status: row.status, reservedParcelId: row.reserved_parcel_id, usedParcelId: row.used_parcel_id, discountMinor: Number(row.discount_minor), createdAt: row.created_at };
}
export function normalizeGrantJoined(row) {
  return { ...normalizeGrant(row), couponCode: row.coupon_code, discountType: row.discount_type, couponStatus: row.coupon_status };
}
