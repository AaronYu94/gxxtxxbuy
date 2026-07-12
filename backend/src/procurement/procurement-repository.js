import { getDbPool } from "../db/pool.js";

// V2-04-04/05 — purchase account persistence. Accounts are versioned for
// optimistic concurrency; assignment reads a platform's preferred enabled
// account (default before backup, oldest first).
export function createPgProcurementRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async createAccount(input) {
      const result = await pool().query(
        `insert into purchase_accounts (platform, label, account_ref, role, owner_admin_id, enabled)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [input.platform, input.label, input.accountRef || "", input.role || "default",
         input.ownerAdminId || null, input.enabled !== false]
      );
      return normalizeAccount(result.rows[0]);
    },

    async findAccount(id) {
      const result = await pool().query("select * from purchase_accounts where id = $1", [id]);
      return normalizeAccount(result.rows[0]);
    },

    async listAccounts({ platform = null, enabled = null } = {}) {
      const result = await pool().query(
        `select * from purchase_accounts
         where ($1::text is null or platform = $1)
           and ($2::boolean is null or enabled = $2)
         order by platform asc, (role = 'default') desc, created_at asc`,
        [platform, enabled]
      );
      return result.rows.map(normalizeAccount);
    },

    // Optimistic update: bump version only when the caller's version still matches.
    async updateAccount(id, expectedVersion, patch) {
      const result = await pool().query(
        `update purchase_accounts set
           label = coalesce($3, label),
           role = coalesce($4, role),
           enabled = coalesce($5, enabled),
           owner_admin_id = coalesce($6, owner_admin_id),
           version = version + 1
         where id = $1 and version = $2
         returning *`,
        [id, expectedVersion, patch.label ?? null, patch.role ?? null,
         patch.enabled ?? null, patch.ownerAdminId ?? null]
      );
      return normalizeAccount(result.rows[0]);
    },

    async pickAccountForPlatform(platform) {
      const result = await pool().query(
        `select * from purchase_accounts
         where platform = $1 and enabled = true
         order by (role = 'default') desc, created_at asc
         limit 1`,
        [platform]
      );
      return normalizeAccount(result.rows[0]);
    }
  };
}

export function normalizeAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    accountRef: row.account_ref,
    role: row.role,
    ownerAdminId: row.owner_admin_id,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
