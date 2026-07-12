// V2-11-04/05 — promotion tier math (pure).
//
// A tier: { code, level, threshold_minor, commission_bps }. The ladder must be
// non-empty, start at threshold 0, and be strictly increasing in level, threshold,
// and (by policy) commission rate — so a cumulative effective amount maps to one
// tier and a higher tier always pays more.

// The default 5-tier ladder (3.5% → 7.5%, four thresholds). These are the frozen
// V2-00-02 defaults; a published version can override them.
export const DEFAULT_TIERS = Object.freeze([
  { code: "P1", level: 1, threshold_minor: 0, commission_bps: 350 },
  { code: "P2", level: 2, threshold_minor: 500000, commission_bps: 450 },
  { code: "P3", level: 3, threshold_minor: 2000000, commission_bps: 550 },
  { code: "P4", level: 4, threshold_minor: 5000000, commission_bps: 650 },
  { code: "P5", level: 5, threshold_minor: 10000000, commission_bps: 750 }
]);

export function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return { ok: false, reason: "at least one tier is required" };
  const sorted = [...tiers].sort((a, b) => (a.level || 0) - (b.level || 0));
  if ((sorted[0].threshold_minor || 0) !== 0) return { ok: false, reason: "the lowest tier must start at threshold 0" };
  let prevLevel = -1;
  let prevThreshold = -1;
  let prevBps = -1;
  for (const t of sorted) {
    if (typeof t.code !== "string" || !t.code) return { ok: false, reason: "each tier needs a code" };
    const level = Number(t.level);
    const threshold = Number(t.threshold_minor);
    const bps = Number(t.commission_bps);
    if (!Number.isInteger(level) || level <= prevLevel) return { ok: false, reason: `levels must strictly increase (at ${t.code})` };
    if (!Number.isInteger(threshold) || threshold < prevThreshold || threshold < 0) return { ok: false, reason: `thresholds must be non-decreasing (at ${t.code})` };
    if (threshold === prevThreshold && prevThreshold >= 0) return { ok: false, reason: `thresholds must be distinct (at ${t.code})` };
    if (!Number.isInteger(bps) || bps <= prevBps || bps <= 0 || bps > 10000) return { ok: false, reason: `commission_bps must strictly increase within 1..10000 (at ${t.code})` };
    prevLevel = level; prevThreshold = threshold; prevBps = bps;
  }
  return { ok: true };
}

// The tier a cumulative effective amount lands in.
export function computeTier(totalEffectiveMinor, tiers) {
  const total = Math.max(0, Math.trunc(totalEffectiveMinor || 0));
  const sorted = [...(tiers || [])].sort((a, b) => (a.threshold_minor || 0) - (b.threshold_minor || 0));
  let current = sorted[0] || null;
  let next = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (total >= (sorted[i].threshold_minor || 0)) { current = sorted[i]; next = sorted[i + 1] || null; }
    else break;
  }
  return {
    tier: current,
    next_tier: next,
    total_effective_minor: total,
    to_next_minor: next ? Math.max(0, (next.threshold_minor || 0) - total) : 0,
    commission_bps: current ? (current.commission_bps || 0) : 0
  };
}
