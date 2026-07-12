import assert from "node:assert/strict";
import test from "node:test";
import { createLogisticsService } from "../src/logistics/logistics-service.js";
import { MemoryLogisticsRepository } from "./helpers/memory-logistics-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };

function service() {
  return createLogisticsService({ repository: new MemoryLogisticsRepository() });
}

async function seedRoute(svc) {
  await svc.createCarrier(ADMIN, ["super_admin"], { code: "SFX", name: "SF Express" });
  await svc.createRoute(ADMIN, ["super_admin"], { carrier_code: "SFX", code: "SFX-US", country: "US", restriction_types: ["normal", "battery"] });
}

test("only a super-admin can change logistics configuration", async () => {
  const svc = service();
  await assert.rejects(() => svc.createCarrier(ADMIN, ["operations"], { code: "X" }), (e) => e.statusCode === 403);
  await svc.createCarrier(ADMIN, ["super_admin"], { code: "X" });
});

test("a new price is a new active version; the old version is kept for history", async () => {
  const svc = service();
  await seedRoute(svc);
  const v1 = (await svc.setPriceVersion(ADMIN, ["super_admin"], "SFX-US", { first_weight_grams: 500, first_price_minor: 5000 })).price_version;
  const v2 = (await svc.setPriceVersion(ADMIN, ["super_admin"], "SFX-US", { first_weight_grams: 500, first_price_minor: 6000 })).price_version;
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  const list = (await svc.listPriceVersions("SFX-US")).price_versions;
  assert.equal(list.length, 2);
  assert.equal(list.filter((v) => v.active).length, 1);
  assert.equal(list.find((v) => v.active).version, 2);
});

test("quote uses the active version and returns an itemized breakdown", async () => {
  const svc = service();
  await seedRoute(svc);
  await svc.setPriceVersion(ADMIN, ["super_admin"], "SFX-US", { first_weight_grams: 500, first_price_minor: 5000, continued_step_grams: 500, continued_price_minor: 3000, rounding_grams: 100 });
  const q = await svc.quote({ route_code: "SFX-US", actual_weight_grams: 1200 });
  assert.equal(q.quote.quotable, true);
  assert.equal(q.quote.breakdown.first_weight_minor, 5000);
  assert.ok(q.quote.total_cny_minor > 5000);
});
