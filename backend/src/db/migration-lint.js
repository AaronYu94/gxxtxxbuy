// V2-12-08 — migration safety lint (pure). Flags destructive statements that must
// not reach production without an explicit, reviewed override. A migration that
// drops tables/columns or truncates data is blocked unless it carries the marker
// comment `-- @destructive-approved`.

const DESTRUCTIVE_RE = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  // Dropping a constraint / trigger / index is a routine, non-data-destructive
  // schema change and is NOT flagged; only column/table/data removal is.
  /\balter\s+table\s+\w+\s+drop\s+column\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bdrop\s+schema\b/i
];

const APPROVAL_MARKER = "@destructive-approved";

// Returns { destructive, approved, findings } for one migration's SQL.
export function lintMigration(sql) {
  const text = String(sql || "");
  const approved = text.includes(APPROVAL_MARKER);
  const findings = [];
  for (const re of DESTRUCTIVE_RE) {
    const m = text.match(re);
    if (m) findings.push(m[0].toLowerCase().replace(/\s+/g, " "));
  }
  // `drop trigger if exists` / `drop index if exists` are routine and idempotent —
  // they are not counted as destructive (they don't lose data).
  return { destructive: findings.length > 0, approved, findings, blocked: findings.length > 0 && !approved };
}

// Lint a set of {file, sql} — returns the blocked ones.
export function lintMigrations(migrations) {
  const blocked = [];
  for (const mig of migrations) {
    const res = lintMigration(mig.sql);
    if (res.blocked) blocked.push({ file: mig.file, findings: res.findings });
  }
  return { ok: blocked.length === 0, blocked };
}
