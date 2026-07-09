import { dequeue } from "../queue/queue.js";
import { extractProductRef } from "./product-ref.js";

// Resolves one saved link through a product source and writes the result back.
// Shared by both the inline path (core service, no Redis) and the standalone queue
// worker. Robust by contract: timeout + retry around the external source, and any
// failure or unresolvable ref falls back to a status the manual-completion flow handles
// (needs_details / failed) — a saved link is never lost.
export async function parseSavedLinkRecord({ repository, source, timeoutMs = 8000, retries = 2 }, job) {
  const userId = job.userId ?? job.user_id;
  const linkId = job.linkId ?? job.link_id;
  const ref = extractProductRef({ url: job.url, platform: job.platform });

  try {
    const product = await withRetry(() => withTimeout(source.fetchProduct(ref), timeoutMs), retries);
    if (!product || !product.title) {
      return repository.updateSavedLink(userId, linkId, { status: "needs_details", parseError: "" });
    }
    const complete = Boolean(product.title && product.spec && product.priceCents);
    return repository.updateSavedLink(userId, linkId, {
      title: product.title,
      spec: product.spec || "",
      priceCents: product.priceCents ?? null,
      currency: product.currency || "USD",
      status: complete ? "parsed" : "needs_details",
      parseError: ""
    });
  } catch (error) {
    return repository.updateSavedLink(userId, linkId, {
      status: "failed",
      parseError: error?.message || "parse_failed"
    });
  }
}

// Standalone worker: drains the links:parse queue. Runs as its own process
// (scripts/parse-worker.mjs) once Redis is configured.
export function createParseWorker({ env, repository, source, dequeueFn = dequeue }) {
  return {
    async runOnce() {
      const job = await dequeueFn(env, "links:parse");
      if (!job) return null;
      const payload = job.payload || job;
      return parseSavedLinkRecord({ repository, source }, {
        url: payload.url,
        platform: payload.platform,
        userId: payload.user_id,
        linkId: payload.link_id
      });
    }
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("parse_timeout")), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function withRetry(fn, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
