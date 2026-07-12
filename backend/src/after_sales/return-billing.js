// V2-08-06 — user-responsible return fee. Freight + operation + packing are platform
// parameters (P1 config seam; fixed defaults until the config surface lands). The
// amounts are snapshotted into the bill's breakdown so a later config change never
// mutates an issued bill.
export const RETURN_FREIGHT_FEE_CNY_MINOR = 1200;   // 12 CNY domestic return freight
export const RETURN_OPERATION_FEE_CNY_MINOR = 300;  // 3 CNY handling
export const RETURN_PACKING_FEE_CNY_MINOR = 200;    // 2 CNY repacking

// Compute the user-responsible return fee. Returns an itemized breakdown + total.
export function computeReturnFee({ freightCnyMinor = RETURN_FREIGHT_FEE_CNY_MINOR, operationCnyMinor = RETURN_OPERATION_FEE_CNY_MINOR, packingCnyMinor = RETURN_PACKING_FEE_CNY_MINOR } = {}) {
  const freight = Math.max(0, Math.trunc(freightCnyMinor));
  const operation = Math.max(0, Math.trunc(operationCnyMinor));
  const packing = Math.max(0, Math.trunc(packingCnyMinor));
  const total = freight + operation + packing;
  return {
    freight_cny_minor: freight,
    operation_cny_minor: operation,
    packing_cny_minor: packing,
    total_cny_minor: total
  };
}
