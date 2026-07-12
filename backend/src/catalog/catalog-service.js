import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { enqueue } from "../queue/queue.js";
import { normalizeLink } from "../parsing/link-normalizer.js";
import { extractProductRef } from "../parsing/product-ref.js";
import { createParseProcessor, PARSE_QUEUE } from "./parse-queue.js";
import { calculatePayable } from "./price-calculator.js";
import {
  optionalMoneyToCents,
  optionalText,
  requiredMoneyToCents,
  requiredPositiveInteger,
  requiredText
} from "../core/core-input.js";

// V2-03-08/10 — orchestrates link parsing, immutable snapshots, and payable-price
// calculation. Ownership is enforced on every read/write; duplicate submissions
// return the same job; scraped and manually-entered data are stored as distinct
// snapshot `source` values and never merged.
export function createCatalogService({
  repository,
  registry,
  env = {},
  queue = null,
  auditLogger = null,
  alerter = null,
  parseInline = false
} = {}) {
  if (!repository) {
    throw new Error("Catalog repository is required.");
  }
  if (!registry) {
    throw new Error("Product source registry is required.");
  }

  const queueAdapter = queue || {
    async enqueue(queueName, payload) {
      return enqueue(env, queueName, payload);
    }
  };
  const processor = createParseProcessor({ repository, registry, queueAdapter, alerter, env });

  return {
    async submitParse(user, input, requestMeta = {}) {
      const normalized = normalizeLink(input?.url);
      const requestKey = normalized.dedupeHash;

      const existing = await repository.findParseJobByRequestKey(user.id, requestKey);
      if (existing) {
        // Idempotent: same canonical link → same job, never a second row.
        return { job: publicParseJob(existing), existing: true };
      }

      const ref = { ...extractProductRef({ url: normalized.url, platform: normalized.platform }), url: normalized.url };
      const job = await repository.createParseJob({
        userId: user.id,
        savedLinkId: input?.saved_link_id || null,
        requestKey,
        platform: normalized.platform,
        url: normalized.url,
        ref
      });
      await queueAdapter.enqueue(PARSE_QUEUE, { user_id: user.id, job_id: job.id });
      await auditLogger?.write?.({
        actorType: "user",
        actorUserId: user.id,
        action: "catalog.parse_submit",
        resourceType: "catalog_parse_job",
        resourceId: job.id,
        metadata: { platform: job.platform },
        requestId: requestMeta.requestId
      }, { critical: false });

      // Inline (demo/dev, no worker): resolve now. With no approved provider this
      // deterministically lands on `manual` — honest degradation, never fake data.
      const processed = parseInline
        ? await processor.process({ userId: user.id, jobId: job.id })
        : job;
      return { job: publicParseJob(processed || job), existing: false };
    },

    async processJob(job) {
      return processor.process(job);
    },

    async getParseJob(user, jobId) {
      const job = await requireOwnedJob(repository, user.id, jobId);
      const snapshot = job.snapshotId ? await repository.findSnapshot(user.id, job.snapshotId) : null;
      return { job: publicParseJob(job), snapshot: snapshot ? publicSnapshot(snapshot) : null };
    },

    async listParseJobs(user) {
      const jobs = await repository.listParseJobs(user.id);
      return { jobs: jobs.map(publicParseJob) };
    },

    async retryParse(user, jobId, requestMeta = {}) {
      const job = await requireOwnedJob(repository, user.id, jobId);
      if (job.status === "snapshotted") {
        throw conflict("A snapshotted job cannot be retried; create a new submission.");
      }
      const reset = await repository.markParseJob(user.id, jobId, { status: "queued", reason: "" });
      await queueAdapter.enqueue(PARSE_QUEUE, { user_id: user.id, job_id: jobId });
      await auditLogger?.write?.({
        actorType: "user",
        actorUserId: user.id,
        action: "catalog.parse_retry",
        resourceType: "catalog_parse_job",
        resourceId: jobId,
        requestId: requestMeta.requestId
      }, { critical: false });
      const processed = parseInline ? await processor.process({ userId: user.id, jobId }) : reset;
      return { job: publicParseJob(processed || reset) };
    },

    // Manual completion when parsing degraded. Stored as a distinct snapshot with
    // source='manual' so it is never confused with scraped supplier data.
    async manualFill(user, jobId, input, requestMeta = {}) {
      const job = await requireOwnedJob(repository, user.id, jobId);
      const priceCents = requiredMoneyToCents(input?.price, "price");
      const domesticShippingCents = optionalMoneyToCents(input?.domestic_shipping, "domestic_shipping");
      const snapshot = await repository.createSnapshot({
        userId: user.id,
        parseJobId: job.jobId,
        savedLinkId: job.savedLinkId,
        platform: job.platform,
        sourceUrl: job.url,
        shop: optionalText(input?.shop, "shop", 240),
        title: requiredText(input?.title, "title", 240),
        mainImage: optionalText(input?.main_image, "main_image", 1024),
        images: sanitizeStringList(input?.images),
        priceCents,
        currency: (optionalText(input?.currency, "currency", 3) || "CNY").toUpperCase(),
        domesticShippingCents,
        spec: optionalText(input?.spec, "spec", 240),
        sizes: sanitizeStringList(input?.sizes),
        colors: sanitizeStringList(input?.colors),
        skus: [],
        priceTiers: [],
        minOrderQuantity: null,
        source: "manual",
        sourceCapturedAt: null
      });
      const updated = await repository.markParseJob(user.id, jobId, {
        status: "snapshotted",
        snapshotId: snapshot.id,
        reason: "manual"
      });
      await auditLogger?.write?.({
        actorType: "user",
        actorUserId: user.id,
        action: "catalog.manual_fill",
        resourceType: "catalog_snapshot",
        resourceId: snapshot.id,
        metadata: { parse_job_id: jobId },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { job: publicParseJob(updated), snapshot: publicSnapshot(snapshot) };
    },

    async getSnapshot(user, snapshotId) {
      const snapshot = await repository.findSnapshot(user.id, snapshotId);
      if (!snapshot) {
        throw notFound("Snapshot not found.");
      }
      return { snapshot: publicSnapshot(snapshot) };
    },

    // V2-03-10 payable price. Integer cents throughout; unknown domestic shipping
    // is surfaced as not-purchasable rather than silently charged as zero.
    async calculatePrice(user, input, requestMeta = {}) {
      const snapshot = await repository.findSnapshot(user.id, input?.snapshot_id);
      if (!snapshot) {
        throw notFound("Snapshot not found.");
      }
      const quantity = requiredPositiveInteger(input?.quantity, "quantity");
      const spec = optionalText(input?.spec, "spec", 240);
      const sku = spec ? snapshot.skus.find((entry) => entry.spec === spec) : null;

      if (spec && snapshot.skus.length && !sku) {
        throw badRequest("Selected specification is not available.", { field: "spec" });
      }
      if (sku && sku.available === false) {
        throw conflict("Selected specification is sold out.");
      }

      const unitPriceCents = sku ? sku.priceCents : snapshot.priceCents;
      // Optional price-change guard so the UI can force a re-confirm.
      if (input?.expected_unit_price_cents !== undefined && input.expected_unit_price_cents !== null) {
        if (Number(input.expected_unit_price_cents) !== unitPriceCents) {
          throw conflict("Price changed since it was shown; please review and reconfirm.", {
            expected_unit_price_cents: Number(input.expected_unit_price_cents),
            current_unit_price_cents: unitPriceCents
          });
        }
      }

      const minOrderQuantity = sku?.minOrderQuantity || snapshot.minOrderQuantity || 1;
      if (quantity < minOrderQuantity) {
        throw badRequest(`Quantity must be at least ${minOrderQuantity}.`, { field: "quantity", min: minOrderQuantity });
      }

      const calculation = calculatePayable({
        unitPriceCents,
        quantity,
        domesticShippingCents: snapshot.domesticShippingCents,
        currency: snapshot.currency
      });
      const stored = await repository.createPriceCalculation({
        userId: user.id,
        snapshotId: snapshot.id,
        spec,
        quantity,
        unitPriceCents: calculation.unitPriceCents,
        itemsCents: calculation.itemsCents,
        domesticShippingCents: calculation.domesticShippingCents,
        totalCents: calculation.totalCents,
        complete: calculation.complete,
        reason: calculation.reason,
        currency: calculation.currency
      });
      return { calculation: publicPriceCalculation(stored) };
    }
  };
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
}

async function requireOwnedJob(repository, userId, jobId) {
  const job = await repository.findParseJobById(userId, jobId);
  if (!job) {
    throw notFound("Parse job not found.");
  }
  return job;
}

export function publicParseJob(job) {
  return {
    id: job.id,
    platform: job.platform,
    url: job.url,
    status: job.status,
    attempt: job.attempt,
    reason: job.reason,
    snapshot_id: job.snapshotId,
    created_at: job.createdAt,
    updated_at: job.updatedAt
  };
}

export function publicSnapshot(snapshot) {
  return {
    id: snapshot.id,
    platform: snapshot.platform,
    source_url: snapshot.sourceUrl,
    shop: snapshot.shop,
    title: snapshot.title,
    main_image: snapshot.mainImage,
    images: snapshot.images,
    price_cents: snapshot.priceCents,
    currency: snapshot.currency,
    domestic_shipping_cents: snapshot.domesticShippingCents,
    spec: snapshot.spec,
    sizes: snapshot.sizes,
    colors: snapshot.colors,
    skus: snapshot.skus,
    price_tiers: snapshot.priceTiers,
    min_order_quantity: snapshot.minOrderQuantity,
    source: snapshot.source,
    source_captured_at: snapshot.sourceCapturedAt,
    created_at: snapshot.createdAt
  };
}

export function publicPriceCalculation(calc) {
  return {
    id: calc.id,
    snapshot_id: calc.snapshotId,
    spec: calc.spec,
    quantity: calc.quantity,
    unit_price_cents: calc.unitPriceCents,
    items_cents: calc.itemsCents,
    domestic_shipping_cents: calc.domesticShippingCents,
    total_cents: calc.totalCents,
    complete: calc.complete,
    reason: calc.reason,
    currency: calc.currency,
    purchasable: calc.complete,
    created_at: calc.createdAt
  };
}
