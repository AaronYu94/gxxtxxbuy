import assert from "node:assert/strict";
import test from "node:test";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const USER = { id: "11111111-1111-1111-1111-111111111111" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

function build({ quotable = true } = {}) {
  const repository = new MemoryConsolidationRepository();
  const financeService = { async debit() { return { transaction: { id: "tx" } }; }, async refund() { return { transaction: { id: "rx" } }; } };
  const logisticsService = {
    async quote({ actual_weight_grams }) {
      if (!quotable) return { route: { id: "r1", code: "SFX-US" }, price_version_id: "pv1", quote: { quotable: false, reason: "max_weight_exceeded" } };
      return { route: { id: "r1", code: "SFX-US" }, price_version_id: "pv1", quote: { quotable: true, chargeableWeightGrams: actual_weight_grams, breakdown: { first_weight_minor: 5000 }, total_cny_minor: 8000 } };
    }
  };
  const svc = createConsolidationService({ repository, financeService, logisticsService });
  return { repository, svc };
}

async function toPacking(svc, repository, stockNo, vasCodes = []) {
  for (const c of vasCodes) await svc.createValueAddedService(ADMIN, ["super_admin"], { code: c.code, price_cny_minor: c.price || 0, requires_photo: Boolean(c.requiresPhoto) });
  repository.seedInventory({ stockNo, userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: [stockNo], value_added_service_codes: vasCodes.map((c) => c.code) });
  const id = created.parcel.id;
  await svc.submitParcel(USER, id, {});
  await svc.payPackingBill(USER, id);
  await svc.acceptForPicking(OP, id);
  await svc.scanPickItem(OP, id, { stock_no: stockNo });
  await svc.startPacking(OP, id);
  return id;
}

test("a photo-required value-added service needs photos to execute", async () => {
  const { repository, svc } = build();
  const id = await toPacking(svc, repository, "GO-STOCK-M1", [{ code: "reinforce", price: 1500, requiresPhoto: true }]);
  const detail = await svc.adminGetParcel(id);
  const vasId = detail.value_added_services[0].id;
  await assert.rejects(() => svc.executeValueAddedService(OP, id, { parcel_vas_id: vasId, photo_keys: [] }), (e) => e.statusCode === 400);
  const done = await svc.executeValueAddedService(OP, id, { parcel_vas_id: vasId, photo_keys: ["k1"] });
  assert.equal(done.value_added_service.status, "done");
});

test("final measurement is blocked until photo services are done, then bills shipping", async () => {
  const { repository, svc } = build();
  const id = await toPacking(svc, repository, "GO-STOCK-M2", [{ code: "reinforce", price: 1500, requiresPhoto: true }]);
  // Photo VAS still pending → measurement blocked.
  await assert.rejects(
    () => svc.finalizeMeasurement(OP, id, { route_code: "SFX-US", final_weight_grams: 1200, dimensions_cm: { length_cm: 30, width_cm: 20, height_cm: 10 } }),
    (e) => e.statusCode === 409
  );
  const detail = await svc.adminGetParcel(id);
  await svc.executeValueAddedService(OP, id, { parcel_vas_id: detail.value_added_services[0].id, photo_keys: ["k1"] });

  const measured = await svc.finalizeMeasurement(OP, id, { route_code: "SFX-US", final_weight_grams: 1200, dimensions_cm: { length_cm: 30, width_cm: 20, height_cm: 10 } });
  assert.equal(measured.parcel.status, "shipping_fee_due");
  assert.equal(measured.parcel.final_weight_grams, 1200);
  const shipping = measured.bills.find((b) => b.kind === "shipping");
  assert.ok(shipping);
  assert.equal(shipping.total_cny_minor, 8000);
  // Two separate bills now.
  assert.equal(measured.bills.length, 2);
});

test("an unquotable parcel does not produce a shipping bill", async () => {
  const { repository, svc } = build({ quotable: false });
  const id = await toPacking(svc, repository, "GO-STOCK-M3");
  await assert.rejects(
    () => svc.finalizeMeasurement(OP, id, { route_code: "SFX-US", final_weight_grams: 99999, dimensions_cm: {} }),
    (e) => e.statusCode === 409
  );
  const detail = await svc.adminGetParcel(id);
  assert.equal(detail.parcel.status, "packing"); // unchanged
  assert.equal(detail.bills.filter((b) => b.kind === "shipping").length, 0);
});
