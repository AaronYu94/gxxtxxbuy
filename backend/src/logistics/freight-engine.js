// V2-07-03 — international freight calculation. Chargeable weight is the greater
// of actual and volumetric weight, rounded UP to the route's rounding step. The
// price is first-weight + continued-weight steps, then fuel (bps of freight),
// remote, operation, and insurance (bps of insured value). Everything is integer
// CNY minor units and every line item is returned for an explainable quote.

export function chargeableWeight({ actualWeightGrams = 0, dimensionsCm = {}, volumetricDivisor = 6000 }) {
  const { length_cm = 0, width_cm = 0, height_cm = 0 } = dimensionsCm;
  const volumetric = length_cm && width_cm && height_cm
    ? Math.ceil((length_cm * width_cm * height_cm * 1000) / (volumetricDivisor || 6000))
    : 0;
  return { actualWeightGrams, volumetricWeightGrams: volumetric, chargeableWeightGrams: Math.max(actualWeightGrams, volumetric) };
}

export function computeFreight({ priceVersion, actualWeightGrams = 0, dimensionsCm = {}, insuredValueMinor = 0, remote = false }) {
  const pv = priceVersion;
  const weight = chargeableWeight({ actualWeightGrams, dimensionsCm, volumetricDivisor: pv.volumetricDivisor });

  const maxWeight = pv.maxWeightGrams || 0;
  if (maxWeight && weight.chargeableWeightGrams > maxWeight) {
    return { quotable: false, reason: "max_weight_exceeded", max_weight_grams: maxWeight, ...weight };
  }

  const step = pv.roundingGrams || 1;
  const roundedGrams = Math.ceil(weight.chargeableWeightGrams / step) * step;

  const first = pv.firstPriceMinor;
  const over = Math.max(0, roundedGrams - pv.firstWeightGrams);
  const continuedUnits = pv.continuedStepGrams > 0 ? Math.ceil(over / pv.continuedStepGrams) : 0;
  const continued = continuedUnits * pv.continuedPriceMinor;
  const freight = first + continued;

  const fuel = Math.floor(freight * (pv.fuelSurchargeBps || 0) / 10000);
  const remoteFee = remote ? (pv.remoteSurchargeMinor || 0) : 0;
  const operation = pv.operationFeeMinor || 0;
  const insurance = Math.floor(Math.max(0, insuredValueMinor) * (pv.insuranceBps || 0) / 10000);

  const total = freight + fuel + remoteFee + operation + insurance;
  return {
    quotable: true,
    ...weight,
    rounded_weight_grams: roundedGrams,
    continued_units: continuedUnits,
    breakdown: {
      first_weight_minor: first,
      continued_weight_minor: continued,
      fuel_surcharge_minor: fuel,
      remote_surcharge_minor: remoteFee,
      operation_fee_minor: operation,
      insurance_minor: insurance
    },
    total_cny_minor: total,
    eta_days: pv.etaDays || 0
  };
}
