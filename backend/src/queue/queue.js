import { randomUUID } from "node:crypto";
import { getRedisClient } from "./redis.js";

const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9:-]{1,80}$/;

export async function enqueue(env, queueName, payload, options = {}) {
  assertQueueName(queueName);

  const job = {
    id: options.jobId || randomUUID(),
    queue: queueName,
    payload,
    attempts: 0,
    enqueued_at: new Date().toISOString()
  };

  const redis = await getRedisClient(env);
  await redis.rPush(queueKey(queueName), JSON.stringify(job));
  return job;
}

export async function dequeue(env, queueName) {
  assertQueueName(queueName);
  const redis = await getRedisClient(env);
  const raw = await redis.lPop(queueKey(queueName));
  return raw ? JSON.parse(raw) : null;
}

export function queueKey(queueName) {
  assertQueueName(queueName);
  return `queue:${queueName}`;
}

function assertQueueName(queueName) {
  if (!QUEUE_NAME_PATTERN.test(queueName || "")) {
    throw new Error("Queue name must be lowercase and may contain numbers, colon, or dash.");
  }
}
