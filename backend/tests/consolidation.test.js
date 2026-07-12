import assert from "node:assert/strict";
import test from "node:test";
import { createConsolidationService } from "../src/consolidation/consolidation-service.js";
import { MemoryConsolidationRepository } from "./helpers/memory-consolidation-repository.js";

const ADMIN = { id: "55555555-5555-5555-5555-555555555555" };
const USER = { id: "11111111-1111-1111-1111-111111111111" };

function build() {
  const repository = new MemoryConsolidationRepository();
  const addressRepository = {
    async findAddress(userId, id) {
      if (userId !== USER.id || id !== "addr-1") return null;
      return { id: "addr-1", userId: USER.id, recipientName: "Jane", phone: "+100", countryCode: "US", region: "CA", city: "LA", postalCode: "90001", line1: "1 St", line2: "", version: 3 };
    }
  };
  const svc = createConsolidationService({ repository, addressRepository });
  return { repository, svc };
}

test("only a super-admin can configure value-added services", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createValueAddedService(ADMIN, ["warehouse_lead"], { code: "reinforce" }), (e) => e.statusCode === 403);
  const { value_added_service } = await svc.createValueAddedService(ADMIN, ["super_admin"], { code: "reinforce", name: "加固", price_cny_minor: 1500, requires_photo: true });
  assert.equal(value_added_service.code, "reinforce");
  assert.equal(value_added_service.price_cny_minor, 1500);
});

test("eligible stock excludes units already reserved in a live parcel", async () => {
  const { repository, svc } = build();
  repository.seedInventory({ stockNo: "GO-STOCK-A", userId: USER.id });
  repository.seedInventory({ stockNo: "GO-STOCK-B", userId: USER.id });
  let eligible = (await svc.listEligibleStock(USER)).eligible_stock;
  assert.equal(eligible.length, 2);
  await svc.createParcel(USER, { stock_nos: ["GO-STOCK-A"], destination_country: "US" });
  eligible = (await svc.listEligibleStock(USER)).eligible_stock;
  assert.deepEqual(eligible.map((e) => e.stock_no), ["GO-STOCK-B"]);
});

test("creating a parcel snapshots the address and reserves the stock", async () => {
  const { repository, svc } = build();
  await svc.createValueAddedService(ADMIN, ["super_admin"], { code: "reinforce", name: "加固", price_cny_minor: 1500 });
  repository.seedInventory({ stockNo: "GO-STOCK-C", userId: USER.id });
  const { parcel, items, value_added_services } = await svc.createParcel(USER, {
    address_id: "addr-1", stock_nos: ["GO-STOCK-C"], value_added_service_codes: ["reinforce"]
  });
  assert.equal(parcel.status, "draft");
  assert.equal(parcel.destination_country, "US");
  assert.equal(parcel.recipient_snapshot.recipient_name, "Jane");
  assert.equal(parcel.recipient_snapshot.version, 3); // frozen address version
  assert.equal(items.length, 1);
  assert.equal(value_added_services[0].code, "reinforce");
  assert.equal(value_added_services[0].price_cny_minor, 1500); // price snapshot
  // The underlying unit is now reserved.
  assert.equal(repository.inventory.get("GO-STOCK-C").status, "reserved");
});

test("a unit cannot be reserved into two parcels", async () => {
  const { repository, svc } = build();
  repository.seedInventory({ stockNo: "GO-STOCK-D", userId: USER.id });
  await svc.createParcel(USER, { stock_nos: ["GO-STOCK-D"], destination_country: "US" });
  await assert.rejects(
    () => svc.createParcel(USER, { stock_nos: ["GO-STOCK-D"], destination_country: "US" }),
    (e) => e.statusCode === 409
  );
});

test("a parcel can only contain the owner's warehoused units", async () => {
  const { repository, svc } = build();
  repository.seedInventory({ stockNo: "GO-STOCK-E", userId: "someone-else" });
  await assert.rejects(
    () => svc.createParcel(USER, { stock_nos: ["GO-STOCK-E"], destination_country: "US" }),
    (e) => e.statusCode === 403
  );
  repository.seedInventory({ stockNo: "GO-STOCK-F", userId: USER.id, status: "picking" });
  await assert.rejects(
    () => svc.createParcel(USER, { stock_nos: ["GO-STOCK-F"], destination_country: "US" }),
    (e) => e.statusCode === 409
  );
});

test("an unknown or disabled value-added service is rejected", async () => {
  const { repository, svc } = build();
  repository.seedInventory({ stockNo: "GO-STOCK-G", userId: USER.id });
  await assert.rejects(
    () => svc.createParcel(USER, { stock_nos: ["GO-STOCK-G"], value_added_service_codes: ["ghost"] }),
    (e) => e.statusCode === 400
  );
});
