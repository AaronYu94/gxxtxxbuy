// V2-03-02 — URL normalization and platform identification.
//
// Turns a raw pasted marketplace link (or a short link, or a tracking-laden URL)
// into a canonical, deduplicated, platform-tagged reference. Pure and offline:
// short links (m.tb.cn, qr.1688.com, koudai share links) require a network
// redirect to resolve, so they are flagged `isShortLink: true` for a real
// adapter to expand later rather than guessed here.
//
// Robustness contract (see V2-03-02 acceptance):
//   - short links               -> normalized, flagged, never fabricated
//   - tracking parameters        -> stripped before hashing so cosmetic variants dedupe
//   - illegal protocols          -> rejected (no javascript:, data:, ftp:, file:)
//   - over-long URLs             -> rejected (> MAX_URL_LENGTH)
//   - duplicate links            -> identical dedupeHash after canonicalization

import { badRequest } from "../errors/app-error.js";
import { hashToken } from "../security/token.js";

export const MAX_URL_LENGTH = 2048;

// Query parameters that never identify a product — marketing, session, and
// referral noise. Stripped before the dedupe hash so the same item pasted from
// an app share, a search result, and a QR scan collapses to one saved link.
const TRACKING_PARAMS = new Set([
  "spm", "scm", "pvid", "utparam", "ali_refid", "ali_trackid", "sourcetype",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "share_crt_v", "sp_tk", "bxsign", "tk", "un", "share_unique_id", "cpp",
  "shareurl", "spm_id_from", "from", "fromsite", "refer", "referer", "referrer",
  "wfr", "app", "abtest", "acm", "aem", "trackid", "clickid", "gclid", "fbclid",
  "_u", "wh_pid", "distributorid", "cbuid", "cbcid"
]);

// Hosts that are share/short redirectors — a real adapter must expand these.
const SHORT_LINK_HOSTS = [
  /(^|\.)tb\.cn$/,
  /(^|\.)m\.tb\.cn$/,
  /(^|\.)qr\.1688\.com$/,
  /(^|\.)k\.weidian\.com$/,
  /(^|\.)dwz\./,
  /(^|\.)url\.cn$/
];

const PLATFORM_MATCHERS = [
  { platform: "1688", test: (h) => /(^|\.)1688\.com$/.test(h) || h.includes("1688.com") },
  { platform: "Weidian", test: (h) => h.includes("weidian.com") || h.includes("koudai.com") || h.includes("vdian.com") },
  { platform: "Yupoo", test: (h) => h.includes("yupoo.com") },
  { platform: "Taobao", test: (h) => h.includes("taobao.com") || h.includes("tmall.com") || /(^|\.)tb\.cn$/.test(h) }
];

// Normalizes a raw link into a canonical form plus a dedupe hash and platform.
// Throws badRequest for empty, over-long, malformed, or illegal-protocol input.
export function normalizeLink(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    throw badRequest("Product URL is required.", { field: "url" });
  }
  if (value.length > MAX_URL_LENGTH) {
    throw badRequest(`Product URL must be ${MAX_URL_LENGTH} characters or fewer.`, { field: "url" });
  }

  // Reject dangerous/unsupported schemes explicitly before defaulting to https,
  // so "javascript:alert(1)" or "file:///etc/passwd" never slip through.
  const explicitScheme = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1])) {
    throw badRequest("Product URL must use http or https.", { field: "url" });
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw badRequest("Product URL must be valid.", { field: "url" });
  }

  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
    throw badRequest("Product URL must be a valid http(s) URL.", { field: "url" });
  }

  const host = url.hostname.toLowerCase();
  const strippedParams = stripTrackingParams(url.searchParams);
  const platform = identifyPlatform(host);
  const isShortLink = SHORT_LINK_HOSTS.some((pattern) => pattern.test(host));

  // Canonical URL for storage/display: lowercased host, no fragment, no www,
  // tracking params removed, remaining params sorted for stable comparison.
  url.hash = "";
  url.hostname = host;
  const canonicalUrl = buildCanonicalUrl(url);

  return {
    url: canonicalUrl,
    dedupeHash: hashToken(canonicalUrl),
    domain: host.replace(/^www\./, ""),
    platform,
    isShortLink,
    strippedParams
  };
}

// Backwards-compatible shape used by the core saved-link flow.
export function toSavedLinkFields(rawUrl) {
  const normalized = normalizeLink(rawUrl);
  return {
    url: normalized.url,
    urlHash: normalized.dedupeHash,
    domain: normalized.domain,
    platform: normalized.platform
  };
}

export function identifyPlatform(hostname) {
  const host = String(hostname || "").toLowerCase();
  const match = PLATFORM_MATCHERS.find((entry) => entry.test(host));
  return match ? match.platform : "Other";
}

function stripTrackingParams(searchParams) {
  const removed = [];
  for (const key of [...searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      searchParams.delete(key);
      removed.push(key);
    }
  }
  return removed;
}

function buildCanonicalUrl(url) {
  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, val] of sorted) {
    url.searchParams.append(key, val);
  }
  let out = url.toString();
  // Drop a bare trailing slash on the path (but keep "/" for a root URL).
  out = out.replace(/\/(\?|$)/, "$1");
  return out;
}
