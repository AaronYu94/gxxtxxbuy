import { randomUUID } from "node:crypto";
import { clone } from "./memory-auth-repository.js";

export class MemoryAccountRepository {
  constructor(authRepository, options = {}) {
    this.auth = authRepository;
    this.addresses = new Map();
    this.deletionRequests = new Map();
    this.blockers = {
      wallet_balance: false, warehouse_items: false, active_orders: false,
      active_parcels: false, active_after_sales: false, ...(options.blockers || {})
    };
  }

  async getAccount(userId) { return this.auth.findUserById(userId); }

  async updateAccount(input) {
    const user = this.auth.users.get(input.userId);
    if (!user || user.version !== input.expectedVersion || user.deletedAt) return null;
    if (user.phone !== input.phone) user.phoneVerifiedAt = null;
    Object.assign(user, {
      displayName: input.displayName, phone: input.phone, countryCode: input.countryCode,
      defaultLocale: input.defaultLocale, defaultCurrency: input.defaultCurrency,
      version: user.version + 1, updatedAt: new Date().toISOString()
    });
    return clone(user);
  }

  async updatePasswordAndRevoke(input) {
    const user = this.auth.users.get(input.userId);
    if (!user || user.version !== input.expectedVersion) return null;
    user.passwordHash = input.passwordHash;
    user.version += 1;
    await this.auth.revokeUserDeviceTrust(user.id);
    await this.auth.revokeActorSessions("user", user.id);
    return clone(user);
  }

  async listAddresses(userId) {
    return [...this.addresses.values()].filter((address) => address.userId === userId && !address.deletedAt)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt)).map(clone);
  }
  async findAddress(userId, id) {
    const address = this.addresses.get(id);
    return address?.userId === userId && !address.deletedAt ? clone(address) : null;
  }
  async createAddress(input) {
    const existing = await this.listAddresses(input.userId);
    const isDefault = input.isDefault || existing.length === 0;
    if (isDefault) this.clearDefaults(input.userId);
    const now = new Date().toISOString();
    const address = { id: randomUUID(), ...input, isDefault, version: 1, createdAt: now, updatedAt: now, deletedAt: null };
    this.addresses.set(address.id, address);
    return clone(address);
  }
  async updateAddress(input) {
    const address = this.addresses.get(input.addressId);
    if (!address || address.userId !== input.userId || address.version !== input.expectedVersion || address.deletedAt) return null;
    if (input.isDefault) this.clearDefaults(input.userId, input.addressId);
    Object.assign(address, input, { version: address.version + 1, updatedAt: new Date().toISOString() });
    return clone(address);
  }
  async deleteAddress(userId, id, expectedVersion) {
    const address = this.addresses.get(id);
    if (!address || address.userId !== userId || address.version !== expectedVersion || address.deletedAt) return null;
    const wasDefault = address.isDefault;
    address.deletedAt = new Date().toISOString();
    address.isDefault = false;
    address.version += 1;
    if (wasDefault) {
      const replacement = [...this.addresses.values()].find((entry) => entry.userId === userId && !entry.deletedAt);
      if (replacement) { replacement.isDefault = true; replacement.version += 1; }
    }
    return clone(address);
  }

  async getDeletionEligibility() {
    return { eligible: !Object.values(this.blockers).some(Boolean), blockers: clone(this.blockers) };
  }
  async requestDeletion(userId) {
    const existing = [...this.deletionRequests.values()].find((request) => request.userId === userId && ["pending", "processing"].includes(request.status));
    if (existing) return { request: clone(existing), existing: true };
    const eligibility = await this.getDeletionEligibility(userId);
    if (!eligibility.eligible) return { blockers: eligibility.blockers };
    const request = {
      id: randomUUID(), userId, status: "pending", blockers: {},
      requestedAt: new Date().toISOString(), completedAt: null
    };
    this.deletionRequests.set(request.id, request);
    const user = this.auth.users.get(userId);
    user.deletionRequestedAt = request.requestedAt;
    user.version += 1;
    await this.auth.revokeActorSessions("user", userId);
    return { request: clone(request), existing: false };
  }
  async processNextDeletion() {
    const request = [...this.deletionRequests.values()].find((entry) => entry.status === "pending");
    if (!request) return null;
    request.status = "completed";
    request.completedAt = new Date().toISOString();
    const user = this.auth.users.get(request.userId);
    user.email = `deleted+${user.id}@anonymous.invalid`;
    user.emailNormalized = user.email;
    user.displayName = "";
    user.phone = null;
    user.countryCode = null;
    user.status = "banned";
    user.anonymizedAt = request.completedAt;
    user.deletedAt = request.completedAt;
    for (const address of this.addresses.values()) {
      if (address.userId === user.id) {
        Object.assign(address, { recipientName: "Deleted user", phone: "", line1: "Deleted", deletedAt: request.completedAt });
      }
    }
    return clone(request);
  }

  clearDefaults(userId, exceptId = "") {
    for (const address of this.addresses.values()) {
      if (address.userId === userId && address.id !== exceptId && !address.deletedAt) address.isDefault = false;
    }
  }
}
