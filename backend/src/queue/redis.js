import { createClient } from "redis";
import { publicErrorMessage, redactUrl } from "../utils/redact.js";

let client;
let connecting;

export async function getRedisClient(env) {
  if (!env.redisUrl) {
    throw new Error("REDIS_URL is not configured.");
  }

  if (client?.isOpen) {
    return client;
  }

  if (!connecting) {
    client = createClient({
      url: env.redisUrl,
      socket: {
        connectTimeout: env.redisConnectTimeoutMs,
        reconnectStrategy: false
      }
    });

    client.on("error", () => {
      // The health endpoint reports connection failures; avoid noisy secret-bearing logs here.
    });

    connecting = client.connect().finally(() => {
      connecting = undefined;
    });
  }

  await connecting;
  return client;
}

export async function checkRedis(env) {
  if (!env.readyRequiresRedis) {
    return {
      name: "redis",
      required: false,
      ok: true,
      skipped: true
    };
  }

  if (!env.redisUrl) {
    return {
      name: "redis",
      required: true,
      ok: false,
      reason: "REDIS_URL not configured"
    };
  }

  const startedAt = performance.now();
  try {
    const redis = await getRedisClient(env);
    await redis.ping();
    return {
      name: "redis",
      required: true,
      ok: true,
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      target: redactUrl(env.redisUrl)
    };
  } catch (error) {
    return {
      name: "redis",
      required: true,
      ok: false,
      reason: "connection_failed",
      message: publicErrorMessage(error)
    };
  }
}

export async function closeRedisClient() {
  if (!client) {
    return;
  }

  const current = client;
  client = undefined;
  if (current.isOpen) {
    await current.quit();
  }
}
