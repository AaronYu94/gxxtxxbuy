import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createEnv, EnvError } from "../config/env.js";
import { redactUrl } from "../utils/redact.js";

const { Pool } = pg;
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
const LOCK_KEY = 91324001;

export async function runMigrations({ env, dryRun = false } = {}) {
  const runtimeEnv = env || createEnv({ requireDatabase: true });
  const pool = new Pool({
    connectionString: runtimeEnv.databaseUrl,
    max: 1,
    connectionTimeoutMillis: runtimeEnv.dbConnectionTimeoutMs,
    idleTimeoutMillis: runtimeEnv.dbIdleTimeoutMs,
    application_name: `${runtimeEnv.serviceName}-migrate`
  });

  const client = await pool.connect();
  const applied = [];
  const skipped = [];

  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureMigrationTable(client);

    const migrations = await readMigrations();
    const appliedRows = await getAppliedMigrations(client);

    for (const migration of migrations) {
      const existing = appliedRows.get(migration.version);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`Migration checksum changed after apply: ${migration.file}`);
        }
        skipped.push(migration.version);
        continue;
      }

      if (dryRun) {
        applied.push(migration.version);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into schema_migrations (version, name, checksum)
           values ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum]
        );
        await client.query("commit");
        applied.push(migration.version);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    return {
      database: redactUrl(runtimeEnv.databaseUrl),
      applied,
      skipped,
      pending: dryRun ? applied : []
    };
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

export async function migrationStatus({ env } = {}) {
  const runtimeEnv = env || createEnv({ requireDatabase: true });
  const pool = new Pool({
    connectionString: runtimeEnv.databaseUrl,
    max: 1,
    connectionTimeoutMillis: runtimeEnv.dbConnectionTimeoutMs,
    idleTimeoutMillis: runtimeEnv.dbIdleTimeoutMs,
    application_name: `${runtimeEnv.serviceName}-migrate-status`
  });

  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);
    const migrations = await readMigrations();
    const appliedRows = await getAppliedMigrations(client);
    return {
      database: redactUrl(runtimeEnv.databaseUrl),
      migrations: migrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        applied: appliedRows.has(migration.version)
      }))
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("select version, checksum from schema_migrations order by version");
  return new Map(result.rows.map((row) => [row.version, row]));
}

async function readMigrations() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{6}_.+\.sql$/.test(file))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
      const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
      return {
        file,
        version,
        name: rest.join("_"),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex")
      };
    })
  );
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const result = statusOnly ? await migrationStatus() : await runMigrations();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error instanceof EnvError) {
      console.error(error.message);
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
}
