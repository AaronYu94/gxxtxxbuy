// V2-09-05/06 — membership tier math (pure).
//
// A tier: { code, level, threshold_growth_minor, freight_discount_bps, benefits }.
// The ladder must be non-empty, start at threshold 0, and be strictly increasing
// in both level and threshold so a growth total maps to exactly one tier.

export function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return { ok: false, reason: "at least one tier is required" };
  const sorted = [...tiers].sort((a, b) => (a.level || 0) - (b.level || 0));
  if ((sorted[0].threshold_growth_minor || 0) !== 0) return { ok: false, reason: "the lowest tier must start at threshold 0" };
  let prevLevel = -1;
  let prevThreshold = -1;
  for (const t of sorted) {
    if (typeof t.code !== "string" || !t.code) return { ok: false, reason: "each tier needs a code" };
    const level = Number(t.level);
    const threshold = Number(t.threshold_growth_minor);
    const bps = Number(t.freight_discount_bps);
    if (!Number.isInteger(level) || level <= prevLevel) return { ok: false, reason: `levels must strictly increase (at ${t.code})` };
    if (!Number.isInteger(threshold) || threshold < prevThreshold || threshold < 0) return { ok: false, reason: `thresholds must be non-decreasing (at ${t.code})` };
    if (threshold === prevThreshold && prevThreshold >= 0) return { ok: false, reason: `thresholds must be distinct (at ${t.code})` };
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return { ok: false, reason: `freight_discount_bps must be 0..10000 (at ${t.code})` };
    prevLevel = level;
    prevThreshold = threshold;
  }
  return { ok: true };
}

// The tier a growth total lands in: the highest tier whose threshold ≤ total.
export function computeTier(totalGrowthMinor, tiers) {
  const total = Math.max(0, Math.trunc(totalGrowthMinor || 0));
  const sorted = [...(tiers || [])].sort((a, b) => (a.threshold_growth_minor || 0) - (b.threshold_growth_minor || 0));
  let current = sorted[0] || null;
  let next = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (total >= (sorted[i].threshold_growth_minor || 0)) { current = sorted[i]; next = sorted[i + 1] || null; }
    else break;
  }
  return {
    tier: current,
    next_tier: next,
    total_growth_minor: total,
    to_next_minor: next ? Math.max(0, (next.threshold_growth_minor || 0) - total) : 0,
    freight_discount_bps: current ? (current.freight_discount_bps || 0) : 0
  };
}
