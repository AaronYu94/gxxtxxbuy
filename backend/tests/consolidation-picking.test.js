import assert from "node:assert/strict";
import test from "node:test";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const OP2 = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function build() {
  const repository = new MemoryConsolidationRepository();
  const financeService = { async debit() { return { transaction: { id: "tx" } }; }, async refund() { return { transaction: { id: "rx" } }; } };
  const svc = createConsolidationService({ repository, financeService });
  return { repository, svc };
}

// Drive a parcel to warehouse_acceptance_pending.
async function toAcceptancePending(svc, repository, stockNos) {
  stockNos.forEach((s) => repository.seedInventory({ stockNo: s, userId: USER.id }));
  const created = await svc.createParcel(USER, { stock_nos: stockNos });
  await svc.submitParcel(USER, created.parcel.id, {});
  await svc.payPackingBill(USER, created.parcel.id);
  return created.parcel.id;
}

test("accept opens a picking task and moves the parcel to picking", async () => {
  const { repository, svc } = build();
  const id = await toAcceptancePending(svc, repository, ["GO-STOCK-K1", "GO-STOCK-K2"]);
  const res = await svc.acceptForPicking(OP, id);
  assert.equal(res.parcel.status, "picking");
  assert.equal(res.picking_task.status, "pending");
});

test("only one operator wins the picking claim", async () => {
  const { repository, svc } = build();
  const id = await toAcceptancePending(svc, repository, ["GO-STOCK-K3"]);
  await svc.acceptForPicking(OP, id);
  const claim = await svc.claimPicking(OP, id);
  assert.equal(claim.picking_task.status, "claimed");
  await assert.rejects(() => svc.claimPicking(OP2, id), (e) => e.statusCode === 409);
});

test("packing cannot start until every unit is scanned", async () => {
  const { repository, svc } = build();
  const id = await toAcceptancePending(svc, repository, ["GO-STOCK-K4", "GO-STOCK-K5"]);
  await svc.acceptForPicking(OP, id);

  const s1 = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-K4" });
  assert.equal(s1.picked, 1);
  assert.equal(s1.total, 2);
  assert.equal(s1.complete_ready, false);
  // Not all scanned → start refused.
  await assert.rejects(() => svc.startPacking(OP, id), (e) => e.statusCode === 409);

  const s2 = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-K5" });
  assert.equal(s2.complete_ready, true);
  const started = await svc.startPacking(OP, id);
  assert.equal(started.parcel.status, "packing");
  assert.ok(started.parcel.version >= 1);
});

test("scanning a unit not in the parcel is rejected; a re-scan is idempotent", async () => {
  const { repository, svc } = build();
  const id = await toAcceptancePending(svc, repository, ["GO-STOCK-K6"]);
  await svc.acceptForPicking(OP, id);
  await assert.rejects(() => svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-NOPE" }), (e) => e.statusCode === 409);
  const a = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-K6" });
  const b = await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-K6" });
  assert.equal(a.picked, 1);
  assert.equal(b.replay, true);
  assert.equal(b.picked, 1); // no double count
});

test("once packing starts the user can no longer cancel", async () => {
  const { repository, svc } = build();
  const id = await toAcceptancePending(svc, repository, ["GO-STOCK-K7"]);
  await svc.acceptForPicking(OP, id);
  await svc.scanPickItem(OP, id, { stock_no: "GO-STOCK-K7" });
  await svc.startPacking(OP, id);
  await assert.rejects(() => svc.cancelParcel(USER, id), (e) => e.statusCode === 409);
});
