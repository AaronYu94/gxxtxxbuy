import { randomUUID } from "node:crypto";
import { normalizeAccount } from "../../src/procurement/procurement-repository.js";

export class MemoryProcurementRepository {
  constructor() {
    this.accounts = new Map();
  }

  async createAccount(input) {
    const now = new Date().toISOString();
    const account = normalizeAccount({
      id: randomUUID(),
      platform: input.platform,
      label: input.label,
      account_ref: input.accountRef || "",
      role: input.role || "default",
      owner_admin_id: input.ownerAdminId || null,
      enabled: input.enabled !== false,
      version: 1,
      created_at: now,
      updated_at: now
    });
    this.accounts.set(account.id, account);
    return clone(account);
  }

  async findAccount(id) {
    const account = this.accounts.get(id);
    return account ? clone(account) : null;
  }

  async listAccounts({ platform = null, enabled = null } = {}) {
    return Array.from(this.accounts.values())
      .filter((a) => (platform === null || a.platform === platform) && (enabled === null || a.enabled === enabled))
      .sort((a, b) => a.platform.localeCompare(b.platform)
        || (b.role === "default") - (a.role === "default")
        || String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async updateAccount(id, expectedVersion, patch) {
    const account = this.accounts.get(id);
    if (!account || account.version !== expectedVersion) {
      return null;
    }
    if (patch.label !== null && patch.label !== undefined) account.label = patch.label;
    if (patch.role !== null && patch.role !== undefined) account.role = patch.role;
    if (patch.enabled !== null && patch.enabled !== undefined) account.enabled = patch.enabled;
    if (patch.ownerAdminId !== null && patch.ownerAdminId !== undefined) account.ownerAdminId = patch.ownerAdminId;
    account.version += 1;
    account.updatedAt = new Date().toISOString();
    return clone(account);
  }

  async pickAccountForPlatform(platform) {
    const candidates = Array.from(this.accounts.values())
      .filter((a) => a.platform === platform && a.enabled)
      .sort((a, b) => (b.role === "default") - (a.role === "default")
        || String(a.createdAt).localeCompare(String(b.createdAt)));
    return candidates[0] ? clone(candidates[0]) : null;
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
