import { randomUUID } from "node:crypto";
import { normalizeCarrier, normalizeRoute, normalizePriceVersion } from "../../src/logistics/logistics-repository.js";

export class MemoryLogisticsRepository {
  constructor() {
    this.carriers = new Map();
    this.routes = new Map();
    this.priceVersions = new Map();
  }

  async createCarrier(input) {
    for (const c of this.carriers.values()) if (c.code === input.code) { const e = new Error("dup"); e.code = "23505"; throw e; }
    const c = normalizeCarrier({ id: randomUUID(), code: input.code, name: input.name || "", enabled: input.enabled !== false, created_at: new Date().toISOString() });
    this.carriers.set(c.id, c);
    return { ...c };
  }
  async listCarriers() { return Array.from(this.carriers.values()).map((c) => ({ ...c })); }
  async findCarrierByCode(code) { for (const c of this.carriers.values()) if (c.code === code) return { ...c }; return null; }

  async createRoute(input) {
    const r = normalizeRoute({ id: randomUUID(), carrier_id: input.carrierId, code: input.code, name: input.name || "", country: input.country || "", restriction_types: input.restrictionTypes || ["normal"], enabled: input.enabled !== false, created_at: new Date().toISOString() });
    this.routes.set(r.id, r);
    return { ...r };
  }
  async findRouteByCode(code) { for (const r of this.routes.values()) if (r.code === code) return { ...r }; return null; }
  async findRouteById(id) { const r = this.routes.get(id); return r ? { ...r } : null; }
  async listRoutes({ country = null, enabled = null } = {}) {
    return Array.from(this.routes.values()).filter((r) => (country === null || r.country === country) && (enabled === null || r.enabled === enabled)).map((r) => ({ ...r }));
  }

  async setPriceVersion(routeId, input, adminUserId) {
    const versions = Array.from(this.priceVersions.values()).filter((v) => v.routeId === routeId);
    versions.forEach((v) => { v.active = false; });
    const version = normalizePriceVersion({
      id: randomUUID(), route_id: routeId, version: (versions.length ? Math.max(...versions.map((v) => v.version)) : 0) + 1,
      first_weight_grams: input.firstWeightGrams, first_price_minor: input.firstPriceMinor, continued_step_grams: input.continuedStepGrams,
      continued_price_minor: input.continuedPriceMinor, volumetric_divisor: input.volumetricDivisor, rounding_grams: input.roundingGrams,
      fuel_surcharge_bps: input.fuelSurchargeBps, remote_surcharge_minor: input.remoteSurchargeMinor, operation_fee_minor: input.operationFeeMinor,
      insurance_bps: input.insuranceBps, eta_days: input.etaDays, max_weight_grams: input.maxWeightGrams, active: true, created_at: new Date().toISOString()
    });
    this.priceVersions.set(version.id, version);
    return { ...version };
  }
  async getActivePriceVersion(routeId) { for (const v of this.priceVersions.values()) if (v.routeId === routeId && v.active) return { ...v }; return null; }
  async getPriceVersionById(id) { const v = this.priceVersions.get(id); return v ? { ...v } : null; }
  async listPriceVersions(routeId) { return Array.from(this.priceVersions.values()).filter((v) => v.routeId === routeId).sort((a, b) => b.version - a.version).map((v) => ({ ...v })); }
}
