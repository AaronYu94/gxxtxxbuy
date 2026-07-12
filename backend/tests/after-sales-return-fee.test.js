import assert from "node:assert/strict";
import test from "node:test";
import { computeReturnFee, RETURN_FREIGHT_FEE_CNY_MINOR, RETURN_OPERATION_FEE_CNY_MINOR, RETURN_PACKING_FEE_CNY_MINOR } from "../src/after_sales/return-billing.js";
import { createAfterSalesService } from "../src/after_sales/after-sales-service.js";
import { MemoryAfterSalesRepository } from "./helpers/memory-after-sales-repository.js";

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const AGENT = { id: "99999999-9999-9999-9999-999999999999" };
const OP = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const NOW = Date.parse("2026-03-10T00:00:00.000Z");

test("return fee sums freight + operation + packing", () => {
  const f = computeReturnFee();
  assert.equal(f.total_cny_minor, RETURN_FREIGHT_FEE_CNY_MINOR + RETURN_OPERATION_FEE_CNY_MINOR + RETURN_PACKING_FEE_CNY_MINOR);
});

function build() {
  const repository = new MemoryAfterSalesRepository();
  const items = new Map();
  const orderRepository = { async findItemById(id) { return items.get(id) || null; } };
  const wallet = { debits: [] };
  const financeService = { async debit(u, a, o) { wallet.debits.push({ u, a, o }); return { transaction: { id: "tx" } }; } };
  const svc = createAfterSalesService({ repository, orderRepository, financeService, clock: () => NOW });
  return { repository, items, svc, wallet };
}

async function approvedUserFreight(svc, repository, items, itemId = "item-1", stockNo = "GO-STOCK-RF") {
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo, returnDeadlineAt: "2026-03-12T00:00:00.000Z" });
  const res = await svc.requestReturn(USER, itemId, { reason: "damaged" });
  const id = res.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "user", freight_party: "user" });
  return id;
}

test("approving user-freight creates a payable return-fee bill; paying advances to picking", async () => {
  const { repository, items, svc, wallet } = build();
  const id = await approvedUserFreight(svc, repository, items);
  const detail = await svc.adminGetAfterSales(id);
  assert.equal(detail.after_sales_order.status, "return_fee_due");
  const bill = detail.bills.find((b) => b.kind === "return_fee");
  assert.ok(bill);
  assert.equal(bill.status, "payable");
  assert.equal(bill.total_cny_minor, RETURN_FREIGHT_FEE_CNY_MINOR + RETURN_OPERATION_FEE_CNY_MINOR + RETURN_PACKING_FEE_CNY_MINOR);

  const paid = await svc.payReturnFee(USER, id);
  assert.equal(paid.after_sales_order.status, "warehouse_picking_pending");
  assert.equal(paid.bills[0].status, "paid");
  assert.equal(wallet.debits.length, 1);
  // Idempotent.
  await svc.payReturnFee(USER, id).catch(() => {});
  assert.equal(wallet.debits.length, 1);
});

test("seller-freight approval skips the fee and needs no payment", async () => {
  const { repository, items, svc } = build();
  const itemId = "item-seller";
  items.set(itemId, { id: itemId, userId: USER.id, quantity: 1, fulfillmentStatus: "warehoused" });
  repository.seedInventory({ itemOrderId: itemId, userId: USER.id, stockNo: "GO-STOCK-SF", returnDeadlineAt: "2026-03-12T00:00:00.000Z" });
  const res = await svc.requestReturn(USER, itemId, { reason: "wrong" });
  const id = res.after_sales_order.id;
  await svc.startReview(AGENT, id);
  await svc.approveReview(AGENT, id, { responsible_party: "seller", freight_party: "seller" });
  const detail = await svc.adminGetAfterSales(id);
  assert.equal(detail.after_sales_order.status, "warehouse_picking_pending");
  assert.equal(detail.bills.length, 0);
});

test("return picking scan requires the matching stock number; wrong item is rejected", async () => {
  const { repository, items, svc } = build();
  const id = await approvedUserFreight(svc, repository, items, "item-1", "GO-STOCK-PICK");
  await svc.payReturnFee(USER, id);

  await assert.rejects(() => svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-WRONG" }), (e) => e.statusCode === 409);
  const picked = await svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-PICK" });
  assert.equal(picked.after_sales_order.status, "return_verifying");
  // Unit moved to returning (atomic with the status change).
  assert.equal(repository.inventory.get("item-1").status, "returning");
});

test("return picking cannot run before the fee is paid", async () => {
  const { repository, items, svc } = build();
  const id = await approvedUserFreight(svc, repository, items, "item-1", "GO-STOCK-NP");
  // Still return_fee_due (unpaid) → picking refused.
  await assert.rejects(() => svc.scanReturnPick(OP, id, { stock_no: "GO-STOCK-NP" }), (e) => e.statusCode === 409);
});
