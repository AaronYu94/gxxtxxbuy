import { getDbPool } from "../db/pool.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// V2-09-01/02/03 — restricted user search, role-tailored detail, CS-assisted edit.
export function createPgUserAdminRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async findById(id) {
      if (!UUID_RE.test(String(id || ""))) return null;
      const r = await pool().query("select * from users where id = $1 and deleted_at is null", [id]);
      return normalizeUser(r.rows[0]);
    },
    async findByEmail(email) {
      const r = await pool().query("select * from users where email_normalized = lower($1) and deleted_at is null", [String(email || "").trim()]);
      return normalizeUser(r.rows[0]);
    },
    // Resolve an order number (parent order or item number) to its owning user.
    async findByOrderNo(orderNo) {
      const r = await pool().query(
        `select u.* from users u
           where u.id = (select user_id from order_parents where order_no = $1
                         union select user_id from item_orders where item_no = $1 limit 1)
           and u.deleted_at is null`,
        [String(orderNo || "").trim()]
      );
      return normalizeUser(r.rows[0]);
    },
    async findByParcelNo(parcelNo) {
      const r = await pool().query(
        `select u.* from users u
           join consolidation_parcels cp on cp.user_id = u.id
           where cp.parcel_no = $1 and u.deleted_at is null limit 1`,
        [String(parcelNo || "").trim()]
      );
      return normalizeUser(r.rows[0]);
    },
    // Bounded prefix search on email / display name.
    async searchByPrefix(prefix, limit = 20) {
      const p = String(prefix || "").trim().toLowerCase();
      if (!p) return [];
      const r = await pool().query(
        `select * from users where deleted_at is null
           and (email_normalized like $1 or lower(display_name) like $1)
           order by created_at desc limit $2`,
        [`${p}%`, Math.min(limit, 50)]
      );
      return r.rows.map(normalizeUser);
    },

    // ---- V2-09-02 per-tab summaries (counts + light rows) ----
    async userCounts(userId) {
      const r = await pool().query(
        `select
           (select count(*) from order_parents where user_id = $1)::int orders,
           (select count(*) from consolidation_parcels where user_id = $1)::int parcels,
           (select count(*) from after_sales_orders where user_id = $1)::int after_sales,
           (select count(*) from addresses where user_id = $1 and deleted_at is null)::int addresses`,
        [userId]
      );
      return r.rows[0] || { orders: 0, parcels: 0, after_sales: 0, addresses: 0 };
    },
    async walletBalance(userId) {
      const r = await pool().query(
        "select coalesce(sum(case when direction='credit' then amount_cny_minor else -amount_cny_minor end),0)::bigint bal from ledger_entries where account = $1",
        [`user:${userId}:available`]
      );
      return Number(r.rows[0]?.bal || 0);
    },
    async recentOrders(userId, limit = 10) {
      const r = await pool().query(
        "select id, order_no, status, total_cents, created_at from order_parents where user_id = $1 order by created_at desc limit $2",
        [userId, limit]
      );
      return r.rows;
    },

    // ---- V2-09-03 CS-assisted profile edit (email change re-verifies) ----
    async assistUpdateProfile(userId, patch, expectedVersion) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const user = (await client.query("select * from users where id = $1 and deleted_at is null for update", [userId])).rows[0];
        if (!user) { await client.query("rollback"); return { notFound: true }; }
        if (expectedVersion != null && user.version !== expectedVersion) { await client.query("rollback"); return { versionConflict: true }; }
        // Locked accounts cannot have sensitive fields edited (V2-09-10).
        if (user.status !== "normal") { await client.query("rollback"); return { locked: true, status: user.status }; }

        const sets = ["version = version + 1", "updated_at = now()"];
        const values = [userId];
        let idx = 2;
        const emailChanged = patch.email && String(patch.email).toLowerCase() !== user.email_normalized;
        for (const [col, val] of Object.entries(patch.columns || {})) {
          sets.push(`${col} = $${idx}`); values.push(val); idx += 1;
        }
        if (emailChanged) {
          sets.push(`email = $${idx}`); values.push(patch.email); idx += 1;
          sets.push(`email_normalized = lower($${idx})`); values.push(patch.email); idx += 1;
          sets.push("email_verified_at = null"); // re-verification required
        }
        const updated = (await client.query(`update users set ${sets.join(", ")} where id = $1 returning *`, values)).rows[0];
        await client.query("commit");
        return { user: normalizeUser(updated), emailChanged: Boolean(emailChanged) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        if (error.code === "23505") return { emailTaken: true };
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id, email: row.email, emailNormalized: row.email_normalized, displayName: row.display_name,
    status: row.status, phone: row.phone, countryCode: row.country_code, defaultLocale: row.default_locale,
    defaultCurrency: row.default_currency, emailVerifiedAt: row.email_verified_at, version: row.version,
    createdAt: row.created_at
  };
}
