import { randomUUID } from "node:crypto";
import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText } from "../core/core-input.js";
import { calculateStorageDeadline } from "./storage-deadline.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_QC_PHOTOS = 3;
const MAX_QC_PHOTOS = 5;

export function createWarehouseService({
  repository,
  storage,
  signedUrlHelper,
  auditLogger,
  clock = () => new Date()
} = {}) {
  if (!repository) throw new Error("Warehouse repository is required.");
  if (!storage) throw new Error("Storage adapter is required.");
  if (!signedUrlHelper) throw new Error("Signed URL helper is required.");

  return {
    async receiveItem(adminUser, targetId, input = {}, requestMeta = {}) {
      const receivable = await repository.findPurchaseOrderForReceive(targetId);
      if (!receivable) {
        throw notFound("Purchase order or haul item not found for receiving.");
      }

      const existing = await repository.findWarehouseItemByOrder(receivable.purchaseOrderId);
      if (existing) {
        return { warehouse_item: publicWarehouseItem(existing), existing: true };
      }

      const item = await repository.createWarehouseItem({
        userId: receivable.userId,
        purchaseOrderId: receivable.purchaseOrderId,
        haulItemId: receivable.haulItemId,
        storageLocation: optionalText(input.storage_location, "storage_location", 120),
        receivedAt: input.received_at || null
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "warehouse.receive",
        resourceType: "warehouse_item",
        resourceId: item.id,
        metadata: { purchase_order_id: item.purchaseOrderId, haul_item_id: item.haulItemId },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { warehouse_item: publicWarehouseItem(item), existing: false };
    },

    async updateWeight(adminUser, warehouseItemId, input = {}, requestMeta = {}) {
      const item = await requireWarehouseItem(repository, warehouseItemId);
      const weightGrams = parseWeightGrams(input);
      const updated = await repository.updateWeight(item.id, weightGrams);
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "warehouse.weight.update",
        resourceType: "warehouse_item",
        resourceId: item.id,
        metadata: { weight_grams: weightGrams },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { warehouse_item: publicWarehouseItem(updated) };
    },

    async uploadQcPhotos(adminUser, warehouseItemId, input = {}, requestMeta = {}) {
      const item = await requireWarehouseItem(repository, warehouseItemId);
      const existingPhotos = await repository.listPhotos(item.id);
      if (existingPhotos.length >= MIN_QC_PHOTOS) {
        return {
          warehouse_item: publicWarehouseItem(item),
          photos: existingPhotos.map((photo) => publicPhoto(photo, signedUrlHelper)),
          existing: true
        };
      }

      const photos = validatePhotoBatch(input.photos);
      const stored = [];
      for (const [index, photo] of photos.entries()) {
        const buffer = Buffer.from(photo.data_base64, "base64");
        if (buffer.length !== photo.size_bytes) {
          throw badRequest("Photo size_bytes must match decoded data.", { field: `photos.${index}.size_bytes` });
        }
        const extension = extensionFromContentType(photo.content_type);
        const key = `qc/${item.userId}/${item.id}/${String(index + 1).padStart(2, "0")}-${randomUUID()}.${extension}`;
        const uploaded = await storage.putObject({
          key,
          body: buffer,
          contentType: photo.content_type
        });
        stored.push(await repository.addQcPhoto({
          userId: item.userId,
          warehouseItemId: item.id,
          storageKey: uploaded.key,
          fileName: photo.file_name,
          contentType: photo.content_type,
          sizeBytes: uploaded.sizeBytes,
          sortOrder: index + 1,
          createdByAdminUserId: adminUser.id
        }));
      }

      const updated = await repository.markQcReady(item.id);
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "qc.photos.upload",
        resourceType: "warehouse_item",
        resourceId: item.id,
        metadata: { photo_count: stored.length },
        requestId: requestMeta.requestId
      }, { critical: true });
      return {
        warehouse_item: publicWarehouseItem(updated),
        photos: stored.map((photo) => publicPhoto(photo, signedUrlHelper)),
        existing: false
      };
    },

    async listUserQcItems(user) {
      const items = await repository.listUserWarehouseItems(user.id);
      const results = [];
      for (const item of items) {
        const photos = await repository.listPhotos(item.id);
        results.push(publicQcItem(item, photos, signedUrlHelper, clock()));
      }
      return { items: results };
    },

    async approveQc(user, warehouseItemId, requestMeta = {}) {
      const item = await requireOwnedWarehouseItem(repository, user.id, warehouseItemId);
      if (item.status === "ready_to_ship") {
        const photos = await repository.listPhotos(item.id);
        return { item: publicQcItem(item, photos, signedUrlHelper, clock()), existing: true };
      }

      const photos = await repository.listPhotos(item.id);
      if (!photos.length) {
        throw conflict("QC photos are required before approval.");
      }
      if (!item.weightGrams || item.weightGrams <= 0) {
        throw conflict("Warehouse weight is required before approval.");
      }

      const updated = await repository.approveQc(user.id, item.id);
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "qc.approve",
        resourceType: "warehouse_item",
        resourceId: item.id,
        metadata: { photo_count: photos.length, weight_grams: item.weightGrams },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { item: publicQcItem(updated, photos, signedUrlHelper, clock()), existing: false };
    },

    async requestExtraPhoto(user, warehouseItemId, input = {}, requestMeta = {}) {
      const item = await requireOwnedWarehouseItem(repository, user.id, warehouseItemId);
      const existing = await repository.findOpenExtraPhotoRequest(user.id, item.id);
      if (existing) {
        return { request: publicExtraPhotoRequest(existing), existing: true };
      }

      const request = await repository.createExtraPhotoRequest({
        userId: user.id,
        warehouseItemId: item.id,
        reason: optionalText(input.reason, "reason", 500)
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "qc.extra_photo.request",
        resourceType: "warehouse_item",
        resourceId: item.id,
        metadata: { request_id: request.id },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { request: publicExtraPhotoRequest(request), existing: false };
    },

    async getStorageStatus(user, warehouseItemId) {
      const item = await requireOwnedWarehouseItem(repository, user.id, warehouseItemId);
      return {
        storage: publicStorageStatus(item, clock())
      };
    }
  };
}

export function publicWarehouseItem(item) {
  return {
    id: item.id,
    user_id: item.userId,
    purchase_order_id: item.purchaseOrderId,
    haul_item_id: item.haulItemId,
    status: item.status,
    storage_location: item.storageLocation,
    weight_grams: item.weightGrams,
    weight_kg: item.weightGrams ? item.weightGrams / 1000 : null,
    received_at: item.receivedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    storage: publicStorageStatus(item)
  };
}

export function publicQcItem(item, photos, signedUrlHelper, now = new Date()) {
  return {
    warehouse_item: {
      ...publicWarehouseItem(item),
      storage: publicStorageStatus(item, now)
    },
    photos: photos.map((photo) => publicPhoto(photo, signedUrlHelper))
  };
}

export function publicPhoto(photo, signedUrlHelper) {
  return {
    id: photo.id,
    file_name: photo.fileName,
    content_type: photo.contentType,
    size_bytes: photo.sizeBytes,
    sort_order: photo.sortOrder,
    signed_url: signedUrlHelper.sign({ key: photo.storageKey, expiresInSeconds: 900 }),
    created_at: photo.createdAt
  };
}

export function publicStorageStatus(item, now = new Date()) {
  const deadline = calculateStorageDeadline(item.receivedAt, item.freeStorageDays, now);
  return {
    received_at: item.receivedAt,
    free_storage_days: item.freeStorageDays,
    free_until: deadline.freeUntil,
    days_left: deadline.daysLeft,
    expired: deadline.expired
  };
}

export function publicExtraPhotoRequest(request) {
  return {
    id: request.id,
    warehouse_item_id: request.warehouseItemId,
    status: request.status,
    reason: request.reason,
    created_at: request.createdAt,
    fulfilled_at: request.fulfilledAt
  };
}

async function requireWarehouseItem(repository, warehouseItemId) {
  const item = await repository.findWarehouseItemById(warehouseItemId);
  if (!item) {
    throw notFound("Warehouse item not found.");
  }
  return item;
}

async function requireOwnedWarehouseItem(repository, userId, warehouseItemId) {
  const item = await repository.findWarehouseItemForUser(userId, warehouseItemId);
  if (!item) {
    throw notFound("Warehouse item not found.");
  }
  return item;
}

function parseWeightGrams(input = {}) {
  const value = input.weight_grams ?? (input.weight_kg !== undefined ? Number(input.weight_kg) * 1000 : null);
  const grams = Number(value);
  if (!Number.isInteger(grams) || grams <= 0 || grams > 200000) {
    throw badRequest("Warehouse weight must be greater than 0.", { field: "weight_grams" });
  }
  return grams;
}

function validatePhotoBatch(photos) {
  if (!Array.isArray(photos) || photos.length < MIN_QC_PHOTOS || photos.length > MAX_QC_PHOTOS) {
    throw badRequest("QC upload must include 3-5 photos.", { field: "photos" });
  }

  return photos.map((photo, index) => {
    const contentType = String(photo?.content_type || "").toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw badRequest("Photo content_type must be image/jpeg, image/png, or image/webp.", {
        field: `photos.${index}.content_type`
      });
    }

    const fileName = optionalText(photo.file_name || `qc-${index + 1}`, `photos.${index}.file_name`, 160);
    const sizeBytes = Number(photo.size_bytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      throw badRequest("Photo size_bytes is invalid.", { field: `photos.${index}.size_bytes` });
    }

    if (!photo.data_base64 || typeof photo.data_base64 !== "string") {
      throw badRequest("Photo data_base64 is required.", { field: `photos.${index}.data_base64` });
    }

    return {
      file_name: fileName,
      content_type: contentType,
      size_bytes: sizeBytes,
      data_base64: photo.data_base64
    };
  });
}

function extensionFromContentType(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}
