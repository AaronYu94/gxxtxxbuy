// B8-02: database backup. Wraps pg_dump using DATABASE_URL and writes a compressed,
// timestamped dump to the backup directory. Restore/verify steps are documented in
// deploy/production/backup-and-restore.md.
//
//   DATABASE_URL=postgres://... BACKUP_DIR=./backups npm run db:backup
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { loadEnvFile } from "../src/config/env.js";

loadEnvFile();

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for a backup.");
  process.exit(1);
}

const backupDir = String(process.env.BACKUP_DIR || "./backups").trim();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = `${backupDir}/goatedbuy-${stamp}.dump`;

await mkdir(backupDir, { recursive: true });

// -Fc = custom compressed format, restorable with pg_restore. No plaintext passwords
// are logged; the connection string is passed via argument to pg_dump only.
const child = spawn("pg_dump", ["-Fc", "--no-owner", "--no-privileges", "-f", outFile, databaseUrl], {
  stdio: ["ignore", "inherit", "inherit"]
});

child.on("error", (error) => {
  console.error(`Failed to run pg_dump. Is the PostgreSQL client installed? ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log(JSON.stringify({ event: "backup_complete", file: outFile }));
  } else {
    console.error(`pg_dump exited with code ${code}.`);
    process.exit(code || 1);
  }
});
