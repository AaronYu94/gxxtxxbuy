import { randomBytes } from "node:crypto";

// V2-00-05 business numbers: {PREFIX}-{RANDOM}. RANDOM is 100 bits of CSPRNG
// entropy encoded in Crockford base32 (20 chars), so nothing about an internal
// primary key, timestamp, user, or order count can be inferred. Every public
// prefix is defined here once and shared by DB checks, API, and UI.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_CHARS = 20; // 20 * 5 bits = 100 bits

export const BUSINESS_NUMBER_PREFIXES = Object.freeze({
  parentOrder: "GO-PO",
  itemOrder: "GO-ITEM",
  forecast: "GO-FWD",
  stock: "GO-STOCK",
  parcel: "GO-PKG",
  afterSales: "GO-AS",
  topUp: "GO-TOP",
  withdrawal: "GO-WD",
  outboundBatch: "GO-BATCH",
  feeBill: "GO-BILL",
  commission: "GO-COM",
  referral: "GO-INV",
  adjustment: "GO-ADJ",
  support: "GO-CS"
});

// Big-endian 5-bit reader over the random bytes. Kept within 32-bit range by
// flushing to fewer than 5 pending bits after every byte.
function encodeCrockford(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return out;
}

export function generateBusinessNumber(prefix) {
  if (!prefix || typeof prefix !== "string") {
    throw new Error("A business-number prefix is required.");
  }
  // 13 bytes = 104 bits of entropy; slice to exactly 100 bits (20 base32 chars).
  const random = encodeCrockford(randomBytes(13)).slice(0, RANDOM_CHARS);
  return `${prefix}-${random}`;
}
