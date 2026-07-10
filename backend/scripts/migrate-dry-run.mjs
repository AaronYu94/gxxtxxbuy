// Migration dry run. Lists migration files and scans for destructive DDL that
// must never be applied straight to production without a reviewed staging dry run.
// Does NOT connect to or modify any database. Exits non-zero when destructive
// statements are found so CI/CD can block the deploy.
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

// Patterns that drop or rewrite data. `drop trigger`/`drop index` are safe idempotent
// recreates used throughout these migrations, so they are explicitly allowed.
const DESTRUCTIVE = [
  { pattern: /\bdrop\s+table\b/i, label: "drop table" },
  { pattern: /\bdrop\s+column\b/i, label: "drop column" },
  { pattern: /\btruncate\b/i, label: "truncate" },
  { pattern: /\bdrop\s+constraint\b/i, label: "drop constraint" },
  { pattern: /\bdrop\s+schema\b/i, label: "drop schema" },
  { pattern: /\balter\s+column\b.*\btype\b/i, label: "alter column type" },
  { pattern: /\bdelete\s+from\b(?![\s\S]*\bwhere\b)/i, label: "unqualified delete" }
];

export function scanMigrationSql(sql) {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return DESTRUCTIVE.filter(({ pattern }) => pattern.test(stripped)).map(({ label }) => label);
}

export async function runDryRun() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{6}_.+\.sql$/.test(file))
    .sort();
  const report = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
    report.push({
      file,
      checksum: createHash("sha256").update(sql).digest("hex").slice(0, 12),
      destructive: scanMigrationSql(sql)
    });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runDryRun();
  for (const entry of report) {
    const flag = entry.destructive.length ? `DESTRUCTIVE: ${entry.destructive.join(", ")}` : "ok";
    console.log(`${entry.file}  ${entry.checksum}  ${flag}`);
  }
  const destructive = report.filter((entry) => entry.destructive.length);
  if (destructive.length) {
    console.error(`\n${destructive.length} migration(s) contain destructive statements. Require a reviewed staging dry run before production.`);
    process.exit(1);
  }
  console.log(`\nDry run ok: ${report.length} migration(s), no destructive statements.`);
}
