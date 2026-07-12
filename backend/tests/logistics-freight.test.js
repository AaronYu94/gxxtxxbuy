import assert from "node:assert/strict";
import test from "node:test";
import { computeFreight, chargeableWeight } from "../src/logistics/freight-engine.js";

const PV = {
  firstWeightGrams: 500, firstPriceMinor: 5000, continuedStepGrams: 500, continuedPriceMinor: 3000,
  volumetricDivisor: 6000, roundingGrams: 100, fuelSurchargeBps: 1000, remoteSurchargeMinor: 2000,
  operationFeeMinor: 500, insuranceBps: 200, etaDays: 7, maxWeightGrams: 30000
};

test("chargeable weight is the max of actual and volumetric", () => {
  const c = chargeableWeight({ actualWeightGrams: 800, dimensionsCm: { length_cm: 30, width_cm: 20, height_cm: 20 }, volumetricDivisor: 6000 });
  assert.equal(c.volumetricWeightGrams, Math.ceil(30 * 20 * 20 * 1000 / 6000)); // 2000
  assert.equal(c.chargeableWeightGrams, 2000); // volumetric > actual
});

test("first-weight only: freight = first + fuel + operation + insurance", () => {
  const r = computeFreight({ priceVersion: PV, actualWeightGrams: 400, insuredValueMinor: 100000 });
  assert.equal(r.quotable, true);
  assert.equal(r.rounded_weight_grams, 400); // 400 rounds to 400 (step 100)
  assert.equal(r.breakdown.first_weight_minor, 5000);
  assert.equal(r.breakdown.continued_weight_minor, 0);
  assert.equal(r.breakdown.fuel_surcharge_minor, 500); // 10% of 5000
  assert.equal(r.breakdown.operation_fee_minor, 500);
  assert.equal(r.breakdown.insurance_minor, 2000); // 2% of 100000
  assert.equal(r.breakdown.remote_surcharge_minor, 0);
  assert.equal(r.total_cny_minor, 5000 + 500 + 500 + 2000);
});

test("continued weight steps and rounding up", () => {
  const r = computeFreight({ priceVersion: PV, actualWeightGrams: 1250, remote: true });
  assert.equal(r.rounded_weight_grams, 1300); // 1250 → up to 1300 (step 100)
  // over first 500 = 800g → 2 steps of 500 (ceil 800/500)
  assert.equal(r.continued_units, 2);
  assert.equal(r.breakdown.continued_weight_minor, 6000);
  const freight = 5000 + 6000;
  assert.equal(r.breakdown.fuel_surcharge_minor, Math.floor(freight * 0.10)); // 1100
  assert.equal(r.breakdown.remote_surcharge_minor, 2000);
  assert.equal(r.total_cny_minor, freight + 1100 + 2000 + 500 + 0);
});

test("over the max weight is not quotable", () => {
  const r = computeFreight({ priceVersion: PV, actualWeightGrams: 40000 });
  assert.equal(r.quotable, false);
  assert.equal(r.reason, "max_weight_exceeded");
});
