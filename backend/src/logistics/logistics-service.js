import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { computeFreight } from "./freight-engine.js";

// V2-07-01/02/03 — carrier/route/price configuration (super-admin only) and the
// freight quote. Editing prices never touches historical parcels; each new price
// is a new version.
export function createLogisticsService({ repository, auditLogger = null } = {}) {
  if (!repository) {
    throw new Error("Logistics repository is required.");
  }

  function requireSuperAdmin(adminRoles) {
    if (!(adminRoles || []).includes("super_admin")) {
      throw forbidden("Only a super-admin can change logistics configuration.");
    }
  }

  return {
    async createCarrier(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const carrier = await repository.createCarrier({
        code: requiredText(input?.code, "code", 40), name: optionalText(input?.name, "name", 120), enabled: input?.enabled !== false
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "logistics.carrier_create", resourceType: "carrier", resourceId: carrier.id, requestId: requestMeta.requestId }, { critical: true });
      return { carrier: publicCarrier(carrier) };
    },

    async listCarriers() {
      return { carriers: (await repository.listCarriers()).map(publicCarrier) };
    },

    async createRoute(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const carrier = await repository.findCarrierByCode(requiredText(input?.carrier_code, "carrier_code", 40));
      if (!carrier) throw notFound("Carrier not found.");
      const route = await repository.createRoute({
        carrierId: carrier.id, code: requiredText(input?.code, "code", 40), name: optionalText(input?.name, "name", 120),
        country: requiredText(input?.country, "country", 40),
        restrictionTypes: Array.isArray(input?.restriction_types) ? input.restriction_types.map(String) : ["normal"],
        enabled: input?.enabled !== false
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "logistics.route_create", resourceType: "shipping_route", resourceId: route.id, requestId: requestMeta.requestId }, { critical: true });
      return { route: publicRoute(route) };
    },

    async listRoutes(query = {}) {
      const rows = await repository.listRoutes({ country: query.country ? String(query.country) : null, enabled: query.enabled === undefined ? null : query.enabled === "true" });
      return { routes: rows.map(publicRoute) };
    },

    async setPriceVersion(adminUser, adminRoles, routeCode, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const route = await repository.findRouteByCode(requiredText(routeCode, "route_code", 40));
      if (!route) throw notFound("Route not found.");
      const firstWeightGrams = positiveInt(input?.first_weight_grams, "first_weight_grams");
      const firstPriceMinor = nonNegInt(input?.first_price_minor, "first_price_minor");
      const version = await repository.setPriceVersion(route.id, {
        firstWeightGrams, firstPriceMinor,
        continuedStepGrams: positiveInt(input?.continued_step_grams ?? 500, "continued_step_grams"),
        continuedPriceMinor: nonNegInt(input?.continued_price_minor ?? 0, "continued_price_minor"),
        volumetricDivisor: positiveInt(input?.volumetric_divisor ?? 6000, "volumetric_divisor"),
        roundingGrams: positiveInt(input?.rounding_grams ?? 1, "rounding_grams"),
        fuelSurchargeBps: nonNegInt(input?.fuel_surcharge_bps ?? 0, "fuel_surcharge_bps"),
        remoteSurchargeMinor: nonNegInt(input?.remote_surcharge_minor ?? 0, "remote_surcharge_minor"),
        operationFeeMinor: nonNegInt(input?.operation_fee_minor ?? 0, "operation_fee_minor"),
        insuranceBps: nonNegInt(input?.insurance_bps ?? 0, "insurance_bps"),
        etaDays: nonNegInt(input?.eta_days ?? 0, "eta_days"),
        maxWeightGrams: input?.max_weight_grams != null ? positiveInt(input.max_weight_grams, "max_weight_grams") : null
      }, adminUser.id);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "logistics.price_version_set", resourceType: "route_price_version", resourceId: version.id, metadata: { route: route.code, version: version.version }, requestId: requestMeta.requestId }, { critical: true });
      return { price_version: publicPriceVersion(version) };
    },

    async listPriceVersions(routeCode) {
      const route = await repository.findRouteByCode(routeCode);
      if (!route) throw notFound("Route not found.");
      return { price_versions: (await repository.listPriceVersions(route.id)).map(publicPriceVersion) };
    },

    // V2-07-03 — quote freight for a route from its ACTIVE price version.
    async quote(input) {
      const route = await repository.findRouteByCode(requiredText(input?.route_code, "route_code", 40));
      if (!route || !route.enabled) throw notFound("Route not available.");
      const pv = await repository.getActivePriceVersion(route.id);
      if (!pv) throw conflict("Route has no active price version.");
      const result = computeFreight({
        priceVersion: pv,
        actualWeightGrams: Number(input?.actual_weight_grams) || 0,
        dimensionsCm: input?.dimensions_cm || {},
        insuredValueMinor: Number(input?.insured_value_minor) || 0,
        remote: Boolean(input?.remote)
      });
      return { route: publicRoute(route), price_version_id: pv.id, quote: result };
    }
  };
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be a positive integer.`, { field });
  return n;
}
function nonNegInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${field} must be a non-negative integer.`, { field });
  return n;
}

export function publicCarrier(c) { return { id: c.id, code: c.code, name: c.name, enabled: c.enabled }; }
export function publicRoute(r) { return { id: r.id, carrier_id: r.carrierId, code: r.code, name: r.name, country: r.country, restriction_types: r.restrictionTypes, enabled: r.enabled }; }
export function publicPriceVersion(v) {
  return {
    id: v.id, route_id: v.routeId, version: v.version, first_weight_grams: v.firstWeightGrams, first_price_minor: v.firstPriceMinor,
    continued_step_grams: v.continuedStepGrams, continued_price_minor: v.continuedPriceMinor, volumetric_divisor: v.volumetricDivisor,
    rounding_grams: v.roundingGrams, fuel_surcharge_bps: v.fuelSurchargeBps, remote_surcharge_minor: v.remoteSurchargeMinor,
    operation_fee_minor: v.operationFeeMinor, insurance_bps: v.insuranceBps, eta_days: v.etaDays, max_weight_grams: v.maxWeightGrams, active: v.active
  };
}
