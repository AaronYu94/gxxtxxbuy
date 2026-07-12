import { getDbPool } from "../db/pool.js";

// V2-07-01/02 — carriers, routes, and versioned prices. A new price version
// deactivates the previous active one; old versions stay for historical parcels.
export function createPgLogisticsRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async createCarrier(input) {
      const result = await pool().query(
        "insert into carriers (code, name, enabled) values ($1, $2, $3) returning *",
        [input.code, input.name || "", input.enabled !== false]
      );
      return normalizeCarrier(result.rows[0]);
    },
    async listCarriers() {
      const result = await pool().query("select * from carriers order by code asc");
      return result.rows.map(normalizeCarrier);
    },
    async findCarrierByCode(code) {
      const result = await pool().query("select * from carriers where code = $1", [code]);
      return normalizeCarrier(result.rows[0]);
    },

    async createRoute(input) {
      const result = await pool().query(
        `insert into shipping_routes (carrier_id, code, name, country, restriction_types, enabled)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [input.carrierId, input.code, input.name || "", input.country || "",
         JSON.stringify(input.restrictionTypes || ["normal"]), input.enabled !== false]
      );
      return normalizeRoute(result.rows[0]);
    },
    async findRouteByCode(code) {
      const result = await pool().query("select * from shipping_routes where code = $1", [code]);
      return normalizeRoute(result.rows[0]);
    },
    async findRouteById(id) {
      const result = await pool().query("select * from shipping_routes where id = $1", [id]);
      return normalizeRoute(result.rows[0]);
    },
    async listRoutes({ country = null, enabled = null } = {}) {
      const result = await pool().query(
        `select * from shipping_routes where ($1::text is null or country = $1) and ($2::boolean is null or enabled = $2) order by code asc`,
        [country, enabled]
      );
      return result.rows.map(normalizeRoute);
    },

    // V2-07-01/02 — set a route's price (new active version). Old version kept.
    async setPriceVersion(routeId, input, adminUserId) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const prev = (await client.query("select coalesce(max(version), 0) v from route_price_versions where route_id = $1", [routeId])).rows[0];
        await client.query("update route_price_versions set active = false where route_id = $1 and active", [routeId]);
        const row = (await client.query(
          `insert into route_price_versions
             (route_id, version, first_weight_grams, first_price_minor, continued_step_grams, continued_price_minor,
              volumetric_divisor, rounding_grams, fuel_surcharge_bps, remote_surcharge_minor, operation_fee_minor,
              insurance_bps, eta_days, max_weight_grams, active, created_by_admin_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15) returning *`,
          [routeId, Number(prev.v) + 1, input.firstWeightGrams, input.firstPriceMinor, input.continuedStepGrams ?? 500,
           input.continuedPriceMinor ?? 0, input.volumetricDivisor ?? 6000, input.roundingGrams ?? 1,
           input.fuelSurchargeBps ?? 0, input.remoteSurchargeMinor ?? 0, input.operationFeeMinor ?? 0,
           input.insuranceBps ?? 0, input.etaDays ?? 0, input.maxWeightGrams ?? null, adminUserId || null]
        )).rows[0];
        await client.query("commit");
        return normalizePriceVersion(row);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async getActivePriceVersion(routeId) {
      const result = await pool().query("select * from route_price_versions where route_id = $1 and active", [routeId]);
      return normalizePriceVersion(result.rows[0]);
    },
    async getPriceVersionById(id) {
      const result = await pool().query("select * from route_price_versions where id = $1", [id]);
      return normalizePriceVersion(result.rows[0]);
    },
    async listPriceVersions(routeId) {
      const result = await pool().query("select * from route_price_versions where route_id = $1 order by version desc", [routeId]);
      return result.rows.map(normalizePriceVersion);
    }
  };
}

export function normalizeCarrier(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, enabled: row.enabled, createdAt: row.created_at };
}

export function normalizeRoute(row) {
  if (!row) return null;
  return {
    id: row.id, carrierId: row.carrier_id, code: row.code, name: row.name, country: row.country,
    restrictionTypes: row.restriction_types || [], enabled: row.enabled, createdAt: row.created_at
  };
}

export function normalizePriceVersion(row) {
  if (!row) return null;
  return {
    id: row.id, routeId: row.route_id, version: row.version,
    firstWeightGrams: row.first_weight_grams, firstPriceMinor: Number(row.first_price_minor),
    continuedStepGrams: row.continued_step_grams, continuedPriceMinor: Number(row.continued_price_minor),
    volumetricDivisor: row.volumetric_divisor, roundingGrams: row.rounding_grams,
    fuelSurchargeBps: row.fuel_surcharge_bps, remoteSurchargeMinor: Number(row.remote_surcharge_minor),
    operationFeeMinor: Number(row.operation_fee_minor), insuranceBps: row.insurance_bps,
    etaDays: row.eta_days, maxWeightGrams: row.max_weight_grams, active: row.active, createdAt: row.created_at
  };
}
