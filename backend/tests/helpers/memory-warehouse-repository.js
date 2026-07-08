import { randomUUID } from "node:crypto";
import {
  normalizeExtraPhotoRequest,
  normalizeQcPhoto,
  normalizeReceivableOrder,
  normalizeWarehouseItem
} from "../../src/warehouse/warehouse-repository.js";

export class MemoryWarehouseRepository {
  constructor() {
    this.receivableOrders = new Map();
    this.receivableByHaulItem = new Map();
    this.warehouseItems = new Map();
    this.warehouseByOrder = new Map();
    this.photos = new Map();
    this.extraRequests = new Map();
    this.haulItemStatuses = new Map();
  }

  seedReceivableOrder(input) {
    const order = normalizeReceivableOrder({
      purchaseOrderId: input.purchaseOrderId || randomUUID(),
      userId: input.userId,
      haulItemId: input.haulItemId || randomUUID(),
      orderStatus: input.orderStatus || "submitted",
      haulItemStatus: input.haulItemStatus || "purchasing"
    });
    this.receivableOrders.set(order.purchaseOrderId, order);
    this.receivableByHaulItem.set(order.haulItemId, order.purchaseOrderId);
    this.haulItemStatuses.set(order.haulItemId, order.haulItemStatus);
    return clone(order);
  }

  async findPurchaseOrderForReceive(targetId) {
    return clone(this.receivableOrders.get(targetId) || this.receivableOrders.get(this.receivableByHaulItem.get(targetId)));
  }

  async findWarehouseItemByOrder(orderId) {
    return clone(this.warehouseItems.get(this.warehouseByOrder.get(orderId)));
  }

  async findWarehouseItemById(id) {
    return clone(this.warehouseItems.get(id));
  }

  async findWarehouseItemForUser(userId, id) {
    const item = this.warehouseItems.get(id);
    return item?.userId === userId ? clone(item) : null;
  }

  async createWarehouseItem(input) {
    const existingId = this.warehouseByOrder.get(input.purchaseOrderId);
    if (existingId) {
      return clone(this.warehouseItems.get(existingId));
    }
    const now = new Date().toISOString();
    const item = normalizeWarehouseItem({
      id: randomUUID(),
      userId: input.userId,
      purchaseOrderId: input.purchaseOrderId,
      haulItemId: input.haulItemId,
      status: "received",
      storageLocation: input.storageLocation || "",
      weightGrams: null,
      freeStorageDays: 90,
      receivedAt: input.receivedAt || now,
      createdAt: now,
      updatedAt: now
    });
    this.warehouseItems.set(item.id, item);
    this.warehouseByOrder.set(item.purchaseOrderId, item.id);
    this.haulItemStatuses.set(item.haulItemId, "arrived");
    return clone(item);
  }

  async updateWeight(warehouseItemId, weightGrams) {
    const item = this.warehouseItems.get(warehouseItemId);
    if (!item) return null;
    item.weightGrams = weightGrams;
    item.updatedAt = new Date().toISOString();
    return clone(item);
  }

  async listPhotos(warehouseItemId) {
    return (this.photos.get(warehouseItemId) || []).filter((photo) => photo.status === "active").map(clone);
  }

  async addQcPhoto(input) {
    const now = new Date().toISOString();
    const photo = normalizeQcPhoto({
      id: randomUUID(),
      userId: input.userId,
      warehouseItemId: input.warehouseItemId,
      storageKey: input.storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      sortOrder: input.sortOrder,
      status: "active",
      createdByAdminUserId: input.createdByAdminUserId,
      createdAt: now
    });
    const photos = this.photos.get(input.warehouseItemId) || [];
    photos.push(photo);
    this.photos.set(input.warehouseItemId, photos);
    return clone(photo);
  }

  async markQcReady(warehouseItemId) {
    const item = this.warehouseItems.get(warehouseItemId);
    if (!item) return null;
    if (item.status !== "ready_to_ship") {
      item.status = "qc_ready";
    }
    item.updatedAt = new Date().toISOString();
    return clone(item);
  }

  async listUserWarehouseItems(userId) {
    return Array.from(this.warehouseItems.values())
      .filter((item) => item.userId === userId)
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
      .map(clone);
  }

  async approveQc(userId, warehouseItemId) {
    const item = this.warehouseItems.get(warehouseItemId);
    if (!item || item.userId !== userId) return null;
    item.status = "ready_to_ship";
    item.updatedAt = new Date().toISOString();
    this.haulItemStatuses.set(item.haulItemId, "ready_to_ship");
    return clone(item);
  }

  async findOpenExtraPhotoRequest(userId, warehouseItemId) {
    const request = Array.from(this.extraRequests.values())
      .find((entry) => entry.userId === userId && entry.warehouseItemId === warehouseItemId && entry.status === "open");
    return clone(request);
  }

  async createExtraPhotoRequest(input) {
    const existing = await this.findOpenExtraPhotoRequest(input.userId, input.warehouseItemId);
    if (existing) return existing;
    const request = normalizeExtraPhotoRequest({
      id: randomUUID(),
      userId: input.userId,
      warehouseItemId: input.warehouseItemId,
      status: "open",
      reason: input.reason || "",
      createdAt: new Date().toISOString()
    });
    this.extraRequests.set(request.id, request);
    const item = this.warehouseItems.get(input.warehouseItemId);
    if (item && item.status !== "ready_to_ship") item.status = "extra_photo_requested";
    return clone(request);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
