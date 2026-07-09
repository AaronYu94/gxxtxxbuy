import { conflict, notFound } from "../errors/app-error.js";
import { enqueue } from "../queue/queue.js";
import {
  optionalMoneyToCents,
  optionalPositiveInteger,
  optionalText,
  requiredMoneyToCents,
  requiredPositiveInteger,
  requiredText,
  validateStatus
} from "./core-input.js";
import { normalizeProductUrl } from "./link-platform.js";
import { parseSavedLinkRecord } from "../parsing/parse-worker.js";
import { FALLBACK_POLICIES } from "./policies.js";

const HAUL_STATUSES = [
  "waiting_purchase",
  "purchasing",
  "seller_shipped",
  "arrived",
  "qc_ready",
  "approved",
  "ready_to_ship",
  "parcel_submitted",
  "cancelled"
];

export function createCoreService({
  repository,
  env,
  queue = null,
  auditLogger = null,
  productSource = null,
  parseInline = false
} = {}) {
  if (!repository) {
    throw new Error("Core repository is required.");
  }

  const queueAdapter = queue || {
    async enqueue(queueName, payload) {
      return enqueue(env, queueName, payload);
    }
  };

  return {
    async saveLink(user, input, requestMeta = {}) {
      const parsed = normalizeProductUrl(input?.url);
      const existing = await repository.findSavedLinkByHash(user.id, parsed.urlHash);
      if (existing) {
        return { link: publicSavedLink(existing), existing: true };
      }

      const link = await repository.createSavedLink({
        userId: user.id,
        url: parsed.url,
        urlHash: parsed.urlHash,
        domain: parsed.domain,
        platform: parsed.platform,
        status: "needs_details"
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "link.save",
        resourceType: "saved_link",
        resourceId: link.id,
        metadata: { platform: link.platform, domain: link.domain },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { link: publicSavedLink(link), existing: false };
    },

    async listLinks(user) {
      const links = await repository.listSavedLinks(user.id);
      return { links: links.map(publicSavedLink) };
    },

    async parseLink(user, linkId, requestMeta = {}) {
      const link = await requireOwnedLink(repository, user.id, linkId);
      await repository.updateSavedLink(user.id, link.id, { status: "parsing", parseError: "" });
      try {
        const job = await queueAdapter.enqueue("links:parse", {
          link_id: link.id,
          user_id: user.id,
          url: link.url,
          platform: link.platform,
          request_id: requestMeta.requestId
        });
        // Inline mode (no async worker / demo): resolve the product now so the link fills
        // in immediately. With Redis + a running worker, parseInline is off and the queued
        // job is processed out of band.
        if (parseInline && productSource) {
          const processed = await parseSavedLinkRecord(
            { repository, source: productSource },
            { url: link.url, platform: link.platform, userId: user.id, linkId: link.id }
          );
          return { link: publicSavedLink(processed), job };
        }
        const updated = await repository.updateSavedLink(user.id, link.id, { status: "parsing" });
        return { link: publicSavedLink(updated), job };
      } catch (error) {
        const failed = await repository.updateSavedLink(user.id, link.id, {
          status: "failed",
          parseError: error.message || "parse_enqueue_failed"
        });
        return {
          link: publicSavedLink(failed),
          job: null,
          error: "parse_enqueue_failed"
        };
      }
    },

    async updateLink(user, linkId, input) {
      await requireOwnedLink(repository, user.id, linkId);
      const patch = buildLinkPatch(input);
      const updated = await repository.updateSavedLink(user.id, linkId, patch);
      if (!updated) {
        throw notFound("Saved link not found.");
      }
      return { link: publicSavedLink(updated) };
    },

    async addLinkToHaul(user, linkId, input = {}, requestMeta = {}) {
      const link = await requireOwnedLink(repository, user.id, linkId);
      const existing = await repository.findHaulItemByLink(user.id, link.id);
      if (existing) {
        return { item: publicHaulItem(existing), existing: true };
      }

      const source = mergeLinkDetails(link, input);
      const item = await repository.createHaulItem({
        userId: user.id,
        savedLinkId: link.id,
        title: requiredText(source.title, "title", 240),
        spec: requiredText(source.spec, "spec", 240),
        priceCents: requiredMoneyToCents(source.price ?? source.priceCents / 100, "price"),
        currency: source.currency || "USD",
        quantity: requiredPositiveInteger(source.quantity, "quantity"),
        note: optionalText(source.note, "note", 1000),
        sourcePlatform: link.platform,
        sourceDomain: link.domain
      });
      await repository.updateSavedLink(user.id, link.id, {
        title: item.title,
        spec: item.spec,
        priceCents: item.priceCents,
        currency: item.currency,
        quantity: item.quantity,
        note: item.note,
        status: "added_to_haul"
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "haul.add_item",
        resourceType: "haul_item",
        resourceId: item.id,
        metadata: { saved_link_id: link.id },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { item: publicHaulItem(item), existing: false };
    },

    async listHaulItems(user, status = "") {
      const normalizedStatus = validateStatus(status, HAUL_STATUSES);
      const items = await repository.listHaulItems(user.id, normalizedStatus);
      return { items: items.map(publicHaulItem) };
    },

    async submitPurchaseOrder(user, input, requestMeta = {}) {
      const itemId = requiredText(input?.haul_item_id ?? input?.item_id, "haul_item_id", 80);
      const item = await repository.findHaulItemById(user.id, itemId);
      if (!item) {
        throw notFound("Haul item not found.");
      }
      const existing = await repository.findPurchaseOrderByItem(user.id, item.id);
      if (existing) {
        return {
          order: await publicOrderWithHistory(repository, user.id, existing),
          existing: true
        };
      }
      if (item.status !== "waiting_purchase") {
        throw conflict("Only waiting_purchase items can be submitted.");
      }

      const order = await repository.createPurchaseOrder({
        userId: user.id,
        haulItemId: item.id,
        reason: "purchase_submitted"
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "purchase_order.submit",
        resourceType: "purchase_order",
        resourceId: order.id,
        metadata: { haul_item_id: item.id },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { order: await publicOrderWithHistory(repository, user.id, order), existing: false };
    },

    async listOrders(user) {
      const orders = await repository.listPurchaseOrders(user.id);
      return { orders: await Promise.all(orders.map((order) => publicOrderWithHistory(repository, user.id, order))) };
    },

    async getOrder(user, orderId) {
      const order = await repository.findPurchaseOrderById(user.id, orderId);
      if (!order) {
        throw notFound("Order not found.");
      }
      return { order: await publicOrderWithHistory(repository, user.id, order) };
    },

    async listPolicies() {
      let policies = [];
      try {
        policies = await repository.listPublishedPolicies();
      } catch {
        policies = [];
      }
      return {
        policies: (policies.length ? policies : FALLBACK_POLICIES).map(publicPolicy)
      };
    }
  };
}

export function publicSavedLink(link) {
  return {
    id: link.id,
    url: link.url,
    domain: link.domain,
    platform: link.platform,
    status: link.status,
    title: link.title,
    spec: link.spec,
    price: link.price,
    currency: link.currency,
    quantity: link.quantity,
    note: link.note,
    parse_error: link.parseError,
    created_at: link.createdAt,
    updated_at: link.updatedAt
  };
}

export function publicHaulItem(item) {
  return {
    id: item.id,
    saved_link_id: item.savedLinkId,
    title: item.title,
    spec: item.spec,
    price: item.price,
    currency: item.currency,
    quantity: item.quantity,
    note: item.note,
    source_platform: item.sourcePlatform,
    source_domain: item.sourceDomain,
    status: item.status,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function publicOrder(order, history = []) {
  return {
    id: order.id,
    haul_item_id: order.haulItemId,
    status: order.status,
    exception: order.exception,
    external_order_no: order.externalOrderNo,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    history
  };
}

export function publicPolicy(policy) {
  return {
    policy_type: policy.policyType,
    title: policy.title,
    body: policy.body,
    version: policy.version,
    updated_at: policy.updatedAt,
    published_at: policy.publishedAt
  };
}

async function requireOwnedLink(repository, userId, linkId) {
  const link = await repository.findSavedLinkById(userId, linkId);
  if (!link) {
    throw notFound("Saved link not found.");
  }
  return link;
}

function buildLinkPatch(input = {}) {
  const patch = {};
  if ("title" in input) patch.title = optionalText(input.title, "title", 240);
  if ("spec" in input) patch.spec = optionalText(input.spec, "spec", 240);
  if ("price" in input) patch.priceCents = optionalMoneyToCents(input.price, "price");
  if ("price_cents" in input) patch.priceCents = optionalMoneyToCents(Number(input.price_cents) / 100, "price_cents");
  if ("currency" in input) patch.currency = optionalText(input.currency, "currency", 3).toUpperCase() || "USD";
  if ("quantity" in input) patch.quantity = optionalPositiveInteger(input.quantity, "quantity");
  if ("note" in input) patch.note = optionalText(input.note, "note", 1000);
  if (patch.title || patch.spec || patch.priceCents || patch.quantity) {
    patch.status = patch.title && patch.spec && patch.priceCents && patch.quantity ? "parsed" : "needs_details";
  }
  return patch;
}

function mergeLinkDetails(link, input = {}) {
  return {
    title: input.title ?? link.title,
    spec: input.spec ?? link.spec,
    price: input.price ?? link.price,
    priceCents: input.price_cents ?? link.priceCents,
    currency: input.currency ?? link.currency,
    quantity: input.quantity ?? link.quantity,
    note: input.note ?? link.note
  };
}

async function publicOrderWithHistory(repository, userId, order) {
  const history = await repository.listOrderHistory(userId, order.id);
  return publicOrder(order, history.map((entry) => ({
    from_status: entry.fromStatus,
    to_status: entry.toStatus,
    changed_by_type: entry.changedByType,
    reason: entry.reason,
    created_at: entry.createdAt
  })));
}
