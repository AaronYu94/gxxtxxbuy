import { getDbPool } from "../db/pool.js";
import { normalizeUser } from "../auth/auth-repository.js";

export function createPgAccountRepository(env) {
  return {
    async getAccount(userId) {
      const result = await getDbPool(env).query("select * from users where id = $1 and deleted_at is null", [userId]);
      return normalizeUser(result.rows[0]);
    },

    async updateAccount(input) {
      const result = await getDbPool(env).query(
        `update users
         set display_name = $3,
             phone = $4,
             phone_verified_at = case when phone is distinct from $4 then null else phone_verified_at end,
             country_code = $5,
             default_locale = $6,
             default_currency = $7,
             version = version + 1
         where id = $1 and version = $2 and deleted_at is null
         returning *`,
        [input.userId, input.expectedVersion, input.displayName, input.phone || null,
          input.countryCode || null, input.defaultLocale, input.defaultCurrency]
      );
      return normalizeUser(result.rows[0]);
    },

    async updatePasswordAndRevoke(input) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `update users set password_hash = $3, version = version + 1
           where id = $1 and version = $2 and deleted_at is null returning *`,
          [input.userId, input.expectedVersion, input.passwordHash]
        );
        if (!result.rowCount) {
          await client.query("rollback");
          return null;
        }
        await client.query(
          "update user_devices set trust_revoked_at = now() where user_id = $1 and trust_revoked_at is null",
          [input.userId]
        );
        await client.query(
          "update sessions set revoked_at = now() where actor_type = 'user' and user_id = $1 and revoked_at is null",
          [input.userId]
        );
        await client.query("commit");
        return normalizeUser(result.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listAddresses(userId) {
      const result = await getDbPool(env).query(
        `select * from addresses where user_id = $1 and deleted_at is null
         order by is_default desc, updated_at desc, id`,
        [userId]
      );
      return result.rows.map(normalizeAddress);
    },

    async findAddress(userId, addressId) {
      const result = await getDbPool(env).query(
        "select * from addresses where id = $1 and user_id = $2 and deleted_at is null",
        [addressId, userId]
      );
      return normalizeAddress(result.rows[0]);
    },

    async createAddress(input) {
      return addressTransaction(env, input.userId, async (client) => {
        const count = await client.query(
          "select count(*)::integer as count from addresses where user_id = $1 and deleted_at is null",
          [input.userId]
        );
        const makeDefault = input.isDefault || count.rows[0].count === 0;
        if (makeDefault) {
          await client.query("update addresses set is_default = false where user_id = $1 and deleted_at is null", [input.userId]);
        }
        const result = await client.query(
          `insert into addresses
            (user_id, recipient_name, phone, country_code, region, city, postal_code, line1, line2, is_default, normalized_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
          [input.userId, input.recipientName, input.phone, input.countryCode, input.region,
            input.city, input.postalCode, input.line1, input.line2, makeDefault, input.normalizedHash]
        );
        return normalizeAddress(result.rows[0]);
      });
    },

    async updateAddress(input) {
      return addressTransaction(env, input.userId, async (client) => {
        const current = await client.query(
          "select id from addresses where id=$1 and user_id=$2 and version=$3 and deleted_at is null for update",
          [input.addressId, input.userId, input.expectedVersion]
        );
        if (!current.rowCount) return null;
        if (input.isDefault) {
          await client.query(
            "update addresses set is_default = false where user_id = $1 and id <> $2 and deleted_at is null",
            [input.userId, input.addressId]
          );
        }
        const result = await client.query(
          `update addresses
           set recipient_name=$4, phone=$5, country_code=$6, region=$7, city=$8,
               postal_code=$9, line1=$10, line2=$11, is_default=$12,
               normalized_hash=$13, version=version+1
           where id=$1 and user_id=$2 and version=$3 and deleted_at is null returning *`,
          [input.addressId, input.userId, input.expectedVersion, input.recipientName, input.phone,
            input.countryCode, input.region, input.city, input.postalCode, input.line1,
            input.line2, input.isDefault, input.normalizedHash]
        );
        return normalizeAddress(result.rows[0]);
      });
    },

    async deleteAddress(userId, addressId, expectedVersion) {
      return addressTransaction(env, userId, async (client) => {
        const current = await client.query(
          "select is_default from addresses where id=$1 and user_id=$2 and version=$3 and deleted_at is null for update",
          [addressId, userId, expectedVersion]
        );
        if (!current.rowCount) return null;
        const result = await client.query(
          `update addresses set deleted_at=now(), is_default=false, version=version+1
           where id=$1 and user_id=$2 and version=$3 and deleted_at is null returning *`,
          [addressId, userId, expectedVersion]
        );
        if (current.rows[0].is_default) {
          await client.query(
            `update addresses set is_default=true, version=version+1
             where id=(select id from addresses where user_id=$1 and deleted_at is null order by updated_at desc, id limit 1)`,
            [userId]
          );
        }
        return normalizeAddress(result.rows[0]);
      });
    },

    async getDeletionEligibility(userId) {
      return getDeletionEligibility(getDbPool(env), userId);
    },

    async requestDeletion(userId) {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const user = await client.query("select id, deletion_requested_at from users where id=$1 and deleted_at is null for update", [userId]);
        if (!user.rowCount) {
          await client.query("rollback");
          return { notFound: true };
        }
        const existing = await client.query(
          "select * from account_deletion_requests where user_id=$1 and status in ('pending','processing') limit 1",
          [userId]
        );
        if (existing.rowCount) {
          await client.query("commit");
          return { request: normalizeDeletionRequest(existing.rows[0]), existing: true };
        }
        const eligibility = await getDeletionEligibility(client, userId);
        if (!eligibility.eligible) {
          await client.query("rollback");
          return { blockers: eligibility.blockers };
        }
        const created = await client.query(
          "insert into account_deletion_requests (user_id) values ($1) returning *",
          [userId]
        );
        await client.query("update users set deletion_requested_at=now(), version=version+1 where id=$1", [userId]);
        await client.query(
          "update sessions set revoked_at=now() where actor_type='user' and user_id=$1 and revoked_at is null",
          [userId]
        );
        await client.query("commit");
        return { request: normalizeDeletionRequest(created.rows[0]), existing: false };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async processNextDeletion() {
      const pool = getDbPool(env);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const claimed = await client.query(
          `select * from account_deletion_requests where status='pending'
           order by requested_at, id for update skip locked limit 1`
        );
        if (!claimed.rowCount) {
          await client.query("commit");
          return null;
        }
        const request = claimed.rows[0];
        await client.query(
          "update account_deletion_requests set status='processing', processing_started_at=now() where id=$1",
          [request.id]
        );
        const anonymousEmail = `deleted+${request.user_id}@anonymous.invalid`;
        await client.query(
          `update addresses
           set recipient_name='Deleted user', phone='', country_code='ZZ', region='', city='Deleted',
               postal_code='-', line1='Deleted', line2='', normalized_hash=encode(digest(id::text, 'sha256'),'hex'),
               is_default=false, deleted_at=coalesce(deleted_at, now()), version=version+1
           where user_id=$1`,
          [request.user_id]
        );
        await client.query(
          `update users
           set email=$2, email_normalized=$2, display_name='', password_hash='disabled', phone=null,
               phone_verified_at=null, country_code=null, status='banned', anonymized_at=now(),
               deleted_at=now(), version=version+1
           where id=$1`,
          [request.user_id, anonymousEmail]
        );
        await client.query("delete from email_verification_tokens where user_id=$1", [request.user_id]);
        await client.query("delete from user_devices where user_id=$1", [request.user_id]);
        await client.query("update sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1", [request.user_id]);
        await client.query(
          `insert into audit_logs (actor_type, action, resource_type, resource_id, metadata)
           values ('system','account.anonymize','user',$1,'{}'::jsonb)`,
          [request.user_id]
        );
        const completed = await client.query(
          "update account_deletion_requests set status='completed', completed_at=now() where id=$1 returning *",
          [request.id]
        );
        await client.query("commit");
        return normalizeDeletionRequest(completed.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function addressTransaction(env, userId, operation) {
  const client = await getDbPool(env).connect();
  try {
    await client.query("begin");
    await client.query("select id from users where id=$1 and deleted_at is null for update", [userId]);
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getDeletionEligibility(queryable, userId) {
  const [wallet, warehouse, orders, parcels] = await Promise.all([
    queryable.query("select coalesce(sum(balance_cents),0)::bigint as amount from wallets where user_id=$1", [userId]),
    queryable.query("select count(*)::integer as count from warehouse_items where user_id=$1 and status <> 'parcel_submitted'", [userId]),
    queryable.query("select count(*)::integer as count from purchase_orders where user_id=$1 and status in ('submitted','purchasing','seller_shipped','arrived','exception')", [userId]),
    queryable.query("select count(*)::integer as count from parcels where user_id=$1 and status not in ('delivered','cancelled')", [userId])
  ]);
  const afterSalesTable = await queryable.query("select to_regclass('public.after_sales_cases') as table_name");
  const afterSales = afterSalesTable.rows[0].table_name
    ? await queryable.query(
      `select count(*)::integer as count from after_sales_cases
       where user_id=$1 and status not in ('completed','cancelled','rejected')`,
      [userId]
    )
    : { rows: [{ count: 0 }] };
  const blockers = {
    wallet_balance: Number(wallet.rows[0].amount) !== 0,
    warehouse_items: warehouse.rows[0].count > 0,
    active_orders: orders.rows[0].count > 0,
    active_parcels: parcels.rows[0].count > 0,
    active_after_sales: afterSales.rows[0].count > 0
  };
  return { eligible: !Object.values(blockers).some(Boolean), blockers };
}

export function normalizeAddress(row) {
  if (!row) return null;
  return {
    id: String(row.id), userId: String(row.user_id ?? row.userId),
    recipientName: row.recipient_name ?? row.recipientName, phone: row.phone,
    countryCode: row.country_code ?? row.countryCode, region: row.region || "", city: row.city,
    postalCode: row.postal_code ?? row.postalCode, line1: row.line1, line2: row.line2 || "",
    isDefault: row.is_default ?? row.isDefault ?? false, normalizedHash: row.normalized_hash ?? row.normalizedHash,
    version: Number(row.version), createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt), deletedAt: toIso(row.deleted_at ?? row.deletedAt)
  };
}

function normalizeDeletionRequest(row) {
  if (!row) return null;
  return {
    id: String(row.id), userId: String(row.user_id ?? row.userId), status: row.status,
    blockers: row.blockers || {}, requestedAt: toIso(row.requested_at ?? row.requestedAt),
    processingStartedAt: toIso(row.processing_started_at ?? row.processingStartedAt),
    completedAt: toIso(row.completed_at ?? row.completedAt)
  };
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
