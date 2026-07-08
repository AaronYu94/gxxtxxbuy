import pg from "pg";
import { publicErrorMessage, redactUrl } from "../utils/redact.js";

const { Pool } = pg;
let pool;

export function getDbPool(env) {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: env.dbPoolMax,
      connectionTimeoutMillis: env.dbConnectionTimeoutMs,
      idleTimeoutMillis: env.dbIdleTimeoutMs,
      application_name: env.serviceName
    });
  }

  return pool;
}

export async function checkDatabase(env) {
  if (!env.readyRequiresDatabase) {
    return {
      name: "postgres",
      required: false,
      ok: true,
      skipped: true
    };
  }

  if (!env.databaseUrl) {
    return {
      name: "postgres",
      required: true,
      ok: false,
      reason: "DATABASE_URL not configured"
    };
  }

  const startedAt = performance.now();
  try {
    const db = getDbPool(env);
    await db.query("select 1 as ok");
    return {
      name: "postgres",
      required: true,
      ok: true,
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      target: redactUrl(env.databaseUrl)
    };
  } catch (error) {
    return {
      name: "postgres",
      required: true,
      ok: false,
      reason: "connection_failed",
      message: publicErrorMessage(error)
    };
  }
}

export async function closeDbPool() {
  if (!pool) {
    return;
  }

  const current = pool;
  pool = undefined;
  await current.end();
}
