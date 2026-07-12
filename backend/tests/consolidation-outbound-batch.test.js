import assert from "node:assert/strict";
import test from "node:test";
import { createOutboundService } from "../src/consolidation/outbound-service.js";
import { MemoryOutboundRepository } from "./helpers/memory-outbound-repository.js";

const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

function build() {
  const repository = new MemoryOutboundRepository();
  const svc = createOutboundService({ repository });
  return { repository, svc };
}

test("loading a parcel opens the batch and binds the parcel", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "outbound" });
  const { batch } = await svc.createBatch(OP, {});
  const loaded = await svc.loadParcel(OP, batch.id, { parcel_id: p.id });
  assert.equal(loaded.batch.status, "loading");
  assert.equal(loaded.parcels.length, 1);
  assert.equal(repository.parcels.get(p.id).outboundBatchId, batch.id);
});

test("a non-outbound parcel cannot be loaded", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "packing" });
  const { batch } = await svc.createBatch(OP, {});
  await assert.rejects(() => svc.loadParcel(OP, batch.id, { parcel_id: p.id }), (e) => e.statusCode === 409);
});

test("a parcel cannot be loaded into two non-terminal batches", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "outbound" });
  const b1 = (await svc.createBatch(OP, {})).batch;
  const b2 = (await svc.createBatch(OP, {})).batch;
  await svc.loadParcel(OP, b1.id, { parcel_id: p.id });
  await assert.rejects(() => svc.loadParcel(OP, b2.id, { parcel_id: p.id }), (e) => e.statusCode === 409);
  // After cancelling b1 the parcel frees up and can join b2.
  await svc.cancelBatch(OP, b1.id);
  const loaded = await svc.loadParcel(OP, b2.id, { parcel_id: p.id });
  assert.equal(loaded.batch.status, "loading");
});

test("handoff requires signed evidence and writes tracking numbers back", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "outbound" });
  const b = (await svc.createBatch(OP, {})).batch;
  await svc.loadParcel(OP, b.id, { parcel_id: p.id });
  await svc.markHandoffPending(OP, b.id);

  // No evidence → rejected.
  await assert.rejects(() => svc.confirmHandoff(OP, b.id, { evidence: [], tracking: [] }), (e) => e.statusCode === 400);

  const res = await svc.confirmHandoff(OP, b.id, { evidence: ["receipt.png"], tracking: [{ parcel_id: p.id, tracking_no: "SF123" }] });
  assert.equal(res.batch.status, "handed_off");
  assert.equal(res.parcels[0].tracking_no, "SF123");
  // Writeback + parcel advanced to in_transit.
  assert.equal(repository.parcels.get(p.id).trackingNo, "SF123");
  assert.equal(repository.parcels.get(p.id).status, "in_transit");

  const done = await svc.completeBatch(OP, b.id);
  assert.equal(done.batch.status, "completed");
});

test("tracking sync advances in_transit → delivered → completed and is idempotent", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "in_transit" });
  const d = await svc.syncTracking(OP, { parcel_id: p.id, status: "delivered" });
  assert.equal(d.status, "delivered");
  // Idempotent re-sync.
  const again = await svc.syncTracking(OP, { parcel_id: p.id, status: "delivered" });
  assert.equal(again.replay, true);
  // Cannot skip straight to completed from a wrong state is enforced by from-state.
  const c = await svc.syncTracking(OP, { parcel_id: p.id, status: "completed" });
  assert.equal(c.status, "completed");
});

test("tracking sync rejects an illegal transition", async () => {
  const { repository, svc } = build();
  const p = repository.seedParcel({ status: "outbound" });
  // outbound → delivered is not allowed (must be in_transit first).
  await assert.rejects(() => svc.syncTracking(OP, { parcel_id: p.id, status: "delivered" }), (e) => e.statusCode === 409);
});
