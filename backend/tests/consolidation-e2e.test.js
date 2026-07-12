import assert from "node:assert/strict";
import test from "node:test";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { createOutboundService } from "../src/consolidation/outbound-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";
import { MemoryOutboundRepository } from "./helpers/memory-outbound-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const USER = { id: "11111111-1111-1111-1111-111111111111" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

// V2-07-22 — the full consolidation → outbound lifecycle end to end, exercising the
// frozen international-parcel state machine, the two-separate-bills rule, the
// pre-packing cancel lock, and tracking writeback through to completion.
test("E2E consolidation: reserve → pack → two bills → outbound → batch handoff → delivered", async () => {
  const consRepo = new MemoryConsolidationRepository();
  // The outbound repo shares the SAME parcel objects the consolidation repo mutates.
  const outRepo = new MemoryOutboundRepository({ parcels: consRepo.parcels, carriers: new Map([["SF", { id: "carrier-sf" }]]) });

  const wallet = { debits: [], refunds: [] };
  const financeService = {
    async debit(u, a, o) { wallet.debits.push({ u, a, o }); return { transaction: { id: "tx" + wallet.debits.length } }; },
    async refund(u, a, o) { wallet.refunds.push({ u, a, o }); return { transaction: { id: "rx" } }; }
  };
  const logisticsService = {
    async quote({ actual_weight_grams }) {
      return { route: { id: "r1", code: "SF-US" }, price_version_id: "pv1", quote: { quotable: true, chargeableWeightGrams: actual_weight_grams, breakdown: { first_weight_minor: 5000 }, total_cny_minor: 12000 } };
    }
  };
  const cons = createConsolidationService({ repository: consRepo, financeService, logisticsService });
  const outbound = createOutboundService({ repository: outRepo });

  // Two warehoused units + a photo value-added service.
  consRepo.seedInventory({ stockNo: "GO-STOCK-E1", userId: USER.id });
  consRepo.seedInventory({ stockNo: "GO-STOCK-E2", userId: USER.id });
  await cons.createValueAddedService(ADMIN, ["super_admin"], { code: "reinforce", price_cny_minor: 1500, requires_photo: true });

  // Eligible stock lists both.
  assert.equal((await cons.listEligibleStock(USER)).eligible_stock.length, 2);

  // (1) Draft parcel with an address snapshot + value-added service; reserves stock.
  const created = await cons.createParcel(USER, { stock_nos: ["GO-STOCK-E1", "GO-STOCK-E2"], value_added_service_codes: ["reinforce"] });
  const id = created.parcel.id;
  assert.equal(created.parcel.status, "draft");
  assert.equal(created.items.length, 2);
  // Both units are now reserved and off the eligible list.
  assert.equal((await cons.listEligibleStock(USER)).eligible_stock.length, 0);

  // (2) Submit → packing-fee bill; pay it.
  const submitted = await cons.submitParcel(USER, id, {});
  assert.equal(submitted.parcel.status, "packing_fee_due");
  const packingBill = submitted.bills.find((b) => b.kind === "packing");
  assert.equal(packingBill.total_cny_minor, 800 + 1500); // base fee + VAS
  const afterPack = await cons.payPackingBill(USER, id);
  assert.equal(afterPack.parcel.status, "warehouse_acceptance_pending");

  // (3) Warehouse accepts, picks each unit, starts packing (the cancel lock point).
  await cons.acceptForPicking(OP, id);
  await cons.scanPickItem(OP, id, { stock_no: "GO-STOCK-E1" });
  const scan2 = await cons.scanPickItem(OP, id, { stock_no: "GO-STOCK-E2" });
  assert.equal(scan2.complete_ready, true);
  const packing = await cons.startPacking(OP, id);
  assert.equal(packing.parcel.status, "packing");
  // Cancel is now refused.
  await assert.rejects(() => cons.cancelParcel(USER, id), (e) => e.statusCode === 409);

  // (4) Execute the photo value-added service, then final measurement → shipping bill.
  const detail = await cons.adminGetParcel(id);
  await cons.executeValueAddedService(OP, id, { parcel_vas_id: detail.value_added_services[0].id, photo_keys: ["vas.jpg"] });
  const measured = await cons.finalizeMeasurement(OP, id, { route_code: "SF-US", final_weight_grams: 1800, dimensions_cm: { length_cm: 30, width_cm: 20, height_cm: 15 } });
  assert.equal(measured.parcel.status, "shipping_fee_due");
  // Two SEPARATE bills now exist.
  assert.equal(measured.bills.length, 2);
  assert.equal(measured.bills.filter((b) => b.kind === "packing").length, 1);
  assert.equal(measured.bills.filter((b) => b.kind === "shipping").length, 1);

  // (5) Pay the international shipping fee; record seal/label/outbound evidence.
  const afterShip = await cons.payShippingBill(USER, id);
  assert.equal(afterShip.parcel.status, "outbound_pending");
  const outboundParcel = await cons.recordOutbound(OP, id, { seal_photo_keys: ["seal.jpg"], label_key: "label.png", outbound_photo_keys: ["out.jpg"] });
  assert.equal(outboundParcel.parcel.status, "outbound");

  // Two debits total: packing fee + shipping fee.
  assert.equal(wallet.debits.length, 2);
  assert.deepEqual(wallet.debits.map((d) => d.a), [800 + 1500, 12000]);

  // (6) Outbound batch: load, handoff with signed evidence + tracking writeback.
  const batch = (await outbound.createBatch(OP, { carrier_code: "SF" })).batch;
  await outbound.loadParcel(OP, batch.id, { parcel_id: id });
  await outbound.markHandoffPending(OP, batch.id);
  const handoff = await outbound.confirmHandoff(OP, batch.id, { evidence: ["carrier-receipt.png"], tracking: [{ parcel_id: id, tracking_no: "SF-INTL-777" }] });
  assert.equal(handoff.batch.status, "handed_off");
  assert.equal(handoff.parcels[0].tracking_no, "SF-INTL-777");

  // Parcel advanced to in_transit with the tracking number written back.
  const shared = consRepo.parcels.get(id);
  assert.equal(shared.status, "in_transit");
  assert.equal(shared.trackingNo, "SF-INTL-777");

  await outbound.completeBatch(OP, batch.id);

  // (7) Tracking sync to delivered → completed.
  assert.equal((await outbound.syncTracking(OP, { parcel_id: id, status: "delivered" })).status, "delivered");
  assert.equal((await outbound.syncTracking(OP, { parcel_id: id, status: "completed" })).status, "completed");
  assert.equal(consRepo.parcels.get(id).status, "completed");
});

test("E2E cancel path: a paid draft cancelled before packing releases stock and refunds", async () => {
  const consRepo = new MemoryConsolidationRepository();
  const wallet = { debits: [], refunds: [] };
  const financeService = {
    async debit(u, a, o) { wallet.debits.push({ a }); return { transaction: { id: "tx" } }; },
    async refund(u, a, o) { wallet.refunds.push({ a }); return { transaction: { id: "rx" } }; }
  };
  const cons = createConsolidationService({ repository: consRepo, financeService });
  consRepo.seedInventory({ stockNo: "GO-STOCK-C1", userId: USER.id });

  const created = await cons.createParcel(USER, { stock_nos: ["GO-STOCK-C1"] });
  const id = created.parcel.id;
  await cons.submitParcel(USER, id, {});
  await cons.payPackingBill(USER, id);
  assert.equal(consRepo.inventory.get("GO-STOCK-C1").status, "reserved");

  const cancelled = await cons.cancelParcel(USER, id);
  assert.equal(cancelled.parcel.status, "cancelled");
  // Stock released, paid bill refunded, unit eligible again.
  assert.equal(consRepo.inventory.get("GO-STOCK-C1").status, "in_stock");
  assert.equal(wallet.refunds.length, 1);
  assert.equal((await cons.listEligibleStock(USER)).eligible_stock.length, 1);
});
