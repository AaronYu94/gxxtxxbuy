// V2-12-01 — object storage policy (pure). Classifies a storage key into a security
// domain, derives its thumbnail key, its lifecycle rule, and the signed-URL TTL.
// Originals are never public; identity documents live in an ISOLATED restricted
// domain (separate bucket prefix, no thumbnails, short-lived signatures).

// Domains map to bucket prefixes so identity material can be a physically separate
// bucket in production.
export const DOMAINS = Object.freeze({
  PUBLIC: "public",        // published assets (banners) — cacheable
  PRIVATE: "private",      // QC photos, parcel photos, receipts — signed access only
  RESTRICTED: "restricted" // identity documents, bank proofs — isolated, audited
});

// Key prefixes that route to the restricted (identity) domain.
const RESTRICTED_PREFIXES = ["identity/", "kyc/", "bank/", "id-doc/"];
const PUBLIC_PREFIXES = ["banner/", "public/"];

export function domainForKey(key) {
  const k = String(key || "");
  if (RESTRICTED_PREFIXES.some((p) => k.startsWith(p))) return DOMAINS.RESTRICTED;
  if (PUBLIC_PREFIXES.some((p) => k.startsWith(p))) return DOMAINS.PUBLIC;
  return DOMAINS.PRIVATE;
}

// Bucket for a key, given the base private bucket + optional identity bucket.
export function bucketForKey(key, { privateBucket, publicBucket, identityBucket }) {
  const domain = domainForKey(key);
  if (domain === DOMAINS.RESTRICTED) return identityBucket || `${privateBucket}-identity`;
  if (domain === DOMAINS.PUBLIC) return publicBucket || `${privateBucket}-public`;
  return privateBucket;
}

// Thumbnail key for an image. Identity documents get NO thumbnail (never derived,
// never cached).
export function thumbnailKey(key) {
  if (domainForKey(key) === DOMAINS.RESTRICTED) return null;
  const s = String(key || "");
  if (!/\.[a-z0-9]+$/i.test(s)) return null;
  return s.replace(/(\.[a-z0-9]+)$/i, "_thumb$1");
}

// Signed-URL TTL (seconds) by domain — restricted material expires fastest.
export function signedTtlSeconds(key, { defaultTtl = 600 } = {}) {
  const domain = domainForKey(key);
  if (domain === DOMAINS.RESTRICTED) return Math.min(defaultTtl, 120); // ≤ 2 min
  if (domain === DOMAINS.PUBLIC) return 0; // public assets don't need signing
  return defaultTtl;
}

// Lifecycle rule (retention + whether originals are ever public). Nothing but the
// public domain is ever readable without a signature.
export function lifecycleRule(key) {
  const domain = domainForKey(key);
  if (domain === DOMAINS.PUBLIC) return { public_read: true, retain_days: 365, cross_region_backup: false };
  if (domain === DOMAINS.RESTRICTED) return { public_read: false, retain_days: 2555, cross_region_backup: true, encrypt: true }; // ~7 years, encrypted, backed up
  return { public_read: false, retain_days: 1095, cross_region_backup: true }; // 3 years
}
