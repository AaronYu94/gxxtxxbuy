import { randomUUID } from "node:crypto";
import {
  normalizeHaulItem,
  normalizeOrderHistory,
  normalizePolicyPage,
  normalizePurchaseOrder,
  normalizeSavedLink
} from "../../src/core/core-repository.js";

export class MemoryCoreRepository {
  constructor(options = {}) {
    this.savedLinks = new Map();
    this.savedLinksByUserHash = new Map();
    this.haulItems = new Map();
    this.haulItemsByUserLink = new Map();
    this.purchaseOrders = new Map();
    this.purchaseOrdersByUserItem = new Map();
    this.orderHistory = new Map();
    this.policies = options.policies || [];
  }

  async findSavedLinkByHash(userId, urlHash) {
    return clone(this.savedLinks.get(this.savedLinksByUserHash.get(`${userId}:${urlHash}`)));
  }

  async findSavedLinkById(userId, linkId) {
    const link = this.savedLinks.get(linkId);
    return link?.userId === userId ? clone(link) : null;
  }

  async createSavedLink(input) {
    const key = `${input.userId}:${input.urlHash}`;
    if (this.savedLinksByUserHash.has(key)) {
      const error = new Error("duplicate saved link");
      error.code = "23505";
      throw error;
    }
    const now = new Date().toISOString();
    const link = normalizeSavedLink({
      id: randomUUID(),
      userId: input.userId,
      url: input.url,
      urlHash: input.urlHash,
      domain: input.domain,
      platform: input.platform,
      status: input.status || "needs_details",
      quantity: 1,
      currency: "USD",
      createdAt: now,
      updatedAt: now
    });
    this.savedLinks.set(link.id, link);
    this.savedLinksByUserHash.set(key, link.id);
    return clone(link);
  }

  async updateSavedLink(userId, linkId, patch) {
    const link = this.savedLinks.get(linkId);
    if (!link || link.userId !== userId) {
      return null;
    }
    Object.assign(link, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
      ...(patch.priceCents !== undefined ? { priceCents: patch.priceCents, price: patch.priceCents / 100 } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.parseError !== undefined ? { parseError: patch.parseError } : {}),
      updatedAt: new Date().toISOString()
    });
    return clone(link);
  }

  async listSavedLinks(userId) {
    return Array.from(this.savedLinks.values())
      .filter((link) => link.userId === userId)
      .sort(sortDesc)
      .map(clone);
  }

  async findHaulItemByLink(userId, linkId) {
    return clone(this.haulItems.get(this.haulItemsByUserLink.get(`${userId}:${linkId}`)));
  }

  async findHaulItemById(userId, itemId) {
    const item = this.haulItems.get(itemId);
    return item?.userId === userId ? clone(item) : null;
  }

  async createHaulItem(input) {
    const now = new Date().toISOString();
    const item = normalizeHaulItem({
      id: randomUUID(),
      userId: input.userId,
      savedLinkId: input.savedLinkId,
      title: input.title,
      spec: input.spec,
      priceCents: input.priceCents,
      currency: input.currency,
      quantity: input.quantity,
      note: input.note,
      sourcePlatform: input.sourcePlatform,
      sourceDomain: input.sourceDomain,
      status: "waiting_purchase",
      createdAt: now,
      updatedAt: now
    });
    this.haulItems.set(item.id, item);
    this.haulItemsByUserLink.set(`${item.userId}:${item.savedLinkId}`, item.id);
    return clone(item);
  }

  async updateHaulItemStatus(userId, itemId, status) {
    const item = this.haulItems.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    item.status = status;
    item.updatedAt = new Date().toISOString();
    return clone(item);
  }

  async listHaulItems(userId, status = "") {
    return Array.from(this.haulItems.values())
      .filter((item) => item.userId === userId && (!status || item.status === status))
      .sort(sortDesc)
      .map(clone);
  }

  async findPurchaseOrderByItem(userId, itemId) {
    return clone(this.purchaseOrders.get(this.purchaseOrdersByUserItem.get(`${userId}:${itemId}`)));
  }

  async createPurchaseOrder(input) {
    const now = new Date().toISOString();
    const order = normalizePurchaseOrder({
      id: randomUUID(),
      userId: input.userId,
      haulItemId: input.haulItemId,
      status: "submitted",
      exception: "",
      externalOrderNo: "",
      internal_notes: "never expose",
      createdAt: now,
      updatedAt: now
    });
    this.purchaseOrders.set(order.id, order);
    this.purchaseOrdersByUserItem.set(`${order.userId}:${order.haulItemId}`, order.id);
    await this.updateHaulItemStatus(input.userId, input.haulItemId, "purchasing");
    const history = normalizeOrderHistory({
      id: randomUUID(),
      orderId: order.id,
      userId: order.userId,
      fromStatus: null,
      toStatus: "submitted",
      changedByType: "user",
      reason: input.reason || "purchase_submitted",
      createdAt: now
    });
    this.orderHistory.set(order.id, [history]);
    return clone(order);
  }

  async listPurchaseOrders(userId) {
    return Array.from(this.purchaseOrders.values())
      .filter((order) => order.userId === userId)
      .sort(sortDesc)
      .map(clone);
  }

  async findPurchaseOrderById(userId, orderId) {
    const order = this.purchaseOrders.get(orderId);
    return order?.userId === userId ? clone(order) : null;
  }

  async listOrderHistory(userId, orderId) {
    return (this.orderHistory.get(orderId) || [])
      .filter((history) => history.userId === userId)
      .map(clone);
  }

  async listPublishedPolicies() {
    return this.policies
      .filter((policy) => policy.status === "published")
      .map((policy) => normalizePolicyPage(policy))
      .map(clone);
  }
}

function sortDesc(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
