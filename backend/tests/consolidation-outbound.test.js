import assert from "node:assert/strict";
import test from "node:test";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

function build() {
  const repository = new MemoryConsolidationRepository();
  const wallet = { debits: [] };
  const financeService = { async debit(u, a, o) { wallet.debits.push({ u, a, o }); return { transaction: { id: "tx" } }; }, async refund() { return { transaction: { id: "rx" } }; } };
  const logisticsService = { async quote({ actual_weight_grams }) { return { route: { id: "r1", code: "SFX-US" }, price_version_id: "pv1", quote: { quotable: true, chargeableWeightGrams: actual_weight_grams, breakdown: { first_weight_minor: 5000 }, total_cny_minor: 8000 } }; } };
  const svc = createConsolidationService({ repository, financeService, logisticsService });
  return { repository, svc, wallet };
}

// Drive a parcel to shipping_fee_due with a shipping bill.
async function toShippingFeeDue(svc, repository, stockNo) {
  repository.seedInventory({ stockNo, userId: USER.id });
  const created = await svc.createParcel(USER, { stock_nos: [stockNo] });
  const id = created.parcel.id;
  await svc.submitParcel(USER, id, {});
  await svc.payPackingBill(USER, id);
  await svc.acceptForPicking(OP, id);
  await svc.scanPickItem(OP, id, { stock_no: stockNo });
  await svc.startPacking(OP, id);
  await svc.finalizeMeasurement(OP, id, { route_code: "SFX-US", final_weight_grams: 1200, dimensions_cm: {} });
  return id;
}

test("paying the shipping bill advances the parcel to outbound_pending", async () => {
  const { repository, svc, wallet } = build();
  const id = await toShippingFeeDue(svc, repository, "GO-STOCK-O1");
  const paid = await svc.payShippingBill(USER, id);
  assert.equal(paid.parcel.status, "outbound_pending");
  assert.equal(paid.bills.find((b) => b.kind === "shipping").status, "paid");
  // Two debits total: the packing fee (setup) + the shipping fee.
  assert.equal(wallet.debits.length, 2);
  assert.equal(wallet.debits[1].a, 8000);
  // Idempotent — no third debit.
  await svc.payShippingBill(USER, id);
  assert.equal(wallet.debits.length, 2);
});

test("outbound requires seal and outbound photos and then marks the parcel outbound", async () => {
  const { repository, svc } = build();
  const id = await toShippingFeeDue(svc, repository, "GO-STOCK-O2");
  await svc.payShippingBill(USER, id);

  await assert.rejects(() => svc.recordOutbound(OP, id, { seal_photo_keys: [], outbound_photo_keys: ["o1"] }), (e) => e.statusCode === 400);
  await assert.rejects(() => svc.recordOutbound(OP, id, { seal_photo_keys: ["s1"], outbound_photo_keys: [] }), (e) => e.statusCode === 400);

  const out = await svc.recordOutbound(OP, id, { seal_photo_keys: ["s1"], label_key: "label.png", outbound_photo_keys: ["o1", "o2"] });
  assert.equal(out.parcel.status, "outbound");
  assert.equal(out.outbound_record.label_key, "label.png");
  assert.deepEqual(out.outbound_record.outbound_photo_keys, ["o1", "o2"]);
});

test("outbound cannot be recorded before the shipping fee is paid", async () => {
  const { repository, svc } = build();
  const id = await toShippingFeeDue(svc, repository, "GO-STOCK-O3");
  // Still shipping_fee_due (not paid) → outbound refused.
  await assert.rejects(() => svc.recordOutbound(OP, id, { seal_photo_keys: ["s1"], outbound_photo_keys: ["o1"] }), (e) => e.statusCode === 409);
});
