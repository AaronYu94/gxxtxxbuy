export function calculatePackageMetrics(items, dimensions = {}, volumetricDivisor = 6000) {
  const actualWeightGrams = items.reduce((sum, item) => sum + Number(item.weightGrams || 0), 0);
  const lengthCm = positiveNumber(dimensions.length_cm ?? dimensions.lengthCm);
  const widthCm = positiveNumber(dimensions.width_cm ?? dimensions.widthCm);
  const heightCm = positiveNumber(dimensions.height_cm ?? dimensions.heightCm);
  const divisor = Number(volumetricDivisor || 6000);
  const volumetricWeightGrams = lengthCm && widthCm && heightCm
    ? Math.ceil((lengthCm * widthCm * heightCm * 1000) / divisor)
    : 0;

  return {
    actualWeightGrams,
    volumetricWeightGrams,
    chargeableWeightGrams: Math.max(actualWeightGrams, volumetricWeightGrams),
    dimensionsCm: {
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm
    },
    girthCm: lengthCm ? lengthCm + 2 * (widthCm + heightCm) : 0
  };
}

export function quoteShippingLine(line, items, dimensions = {}) {
  const billing = line.billingRules || {};
  const restrictions = line.restrictionRules || {};
  const metrics = calculatePackageMetrics(items, dimensions, billing.volumetric_divisor);
  const reasons = [];

  if (line.status !== "active") {
    reasons.push({
      code: "LINE_DISABLED",
      message: "Shipping line is currently disabled."
    });
  }

  const maxWeight = Number(restrictions.max_weight_grams || 0);
  if (maxWeight && metrics.chargeableWeightGrams > maxWeight) {
    reasons.push({
      code: "MAX_WEIGHT_EXCEEDED",
      message: `Chargeable weight exceeds ${maxWeight}g limit.`
    });
  }

  const maxLength = Number(restrictions.max_length_cm || 0);
  if (maxLength && metrics.dimensionsCm.length_cm > maxLength) {
    reasons.push({
      code: "MAX_LENGTH_EXCEEDED",
      message: `Length exceeds ${maxLength}cm limit.`
    });
  }

  const maxGirth = Number(restrictions.max_girth_cm || 0);
  if (maxGirth && metrics.girthCm > maxGirth) {
    reasons.push({
      code: "MAX_GIRTH_EXCEEDED",
      message: `Length plus girth exceeds ${maxGirth}cm limit.`
    });
  }

  if (!items.length || metrics.actualWeightGrams <= 0) {
    reasons.push({
      code: "NO_WEIGHT",
      message: "Warehouse item weight is required before quoting."
    });
  }

  const chargeableWeightGrams = Math.max(
    metrics.chargeableWeightGrams,
    Number(billing.min_chargeable_grams || 0)
  );
  const baseCents = Number(billing.base_cents || 0);
  const perKgCents = Number(billing.per_kg_cents || 0);
  const subtotal = baseCents + Math.ceil((chargeableWeightGrams / 1000) * perKgCents);
  const surchargePercent = Number(billing.fuel_surcharge_percent || 0);
  const amountCents = Math.ceil(subtotal * (1 + surchargePercent / 100));

  return {
    available: reasons.length === 0,
    reasons,
    amountCents,
    currency: line.currency || "USD",
    actualWeightGrams: metrics.actualWeightGrams,
    volumetricWeightGrams: metrics.volumetricWeightGrams,
    chargeableWeightGrams,
    deliveryMinDays: line.deliveryMinDays,
    deliveryMaxDays: line.deliveryMaxDays
  };
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
