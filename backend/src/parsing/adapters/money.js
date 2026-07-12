// Yuan → integer cents conversion for adapters. Keeps the "no silent zero" rule:
// a missing/blank price yields null (unknown), never 0. Guards against float drift
// by rounding to the nearest cent.
export function optionalYuanToCents(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.round(number * 100);
}

export function yuanToCents(value) {
  const cents = optionalYuanToCents(value);
  if (cents === null) {
    throw new Error("Expected a numeric yuan amount.");
  }
  return cents;
}
