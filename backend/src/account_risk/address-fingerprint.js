// V2-09-11 — standardized address fingerprints for blacklist matching. We match on
// the ADDRESS only (no IP blacklist). An exact fingerprint hit or a looser fuzzy
// hit both route to MANUAL REVIEW — matching never auto-bans.

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// The strict fingerprint: full normalized address. Two addresses with the same
// strict fingerprint are the same place.
export function strictFingerprint(addr) {
  if (!addr) return "";
  const parts = [addr.country_code || addr.countryCode, addr.postal_code || addr.postalCode, addr.city, addr.line1, addr.line2];
  return parts.map(norm).filter(Boolean).join("|");
}

// The fuzzy key: country + postal + the first token of line1 (house number /
// building). Collides for near-duplicates (unit variations, typo'd line2), which
// is exactly what should go to a human, not an auto-ban.
export function fuzzyKey(addr) {
  if (!addr) return "";
  const country = norm(addr.country_code || addr.countryCode);
  const postal = norm(addr.postal_code || addr.postalCode);
  const line1First = norm(addr.line1).split(" ")[0] || "";
  if (!country || !postal) return "";
  return [country, postal, line1First].filter(Boolean).join("|");
}

// Decide the verdict for a candidate against blacklist hits.
//   exact  → an entry with the same strict fingerprint
//   fuzzy  → entries sharing the fuzzy key but not the strict fingerprint
// Either kind of hit means "review" (manual), never an automatic ban.
export function verdict({ exact, fuzzy }) {
  if (exact) return { matched: true, kind: "exact", action: "review" };
  if (fuzzy && fuzzy.length > 0) return { matched: true, kind: "fuzzy", action: "review" };
  return { matched: false, kind: "none", action: "clear" };
}
