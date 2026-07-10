import { createHmac } from "node:crypto";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../errors/app-error.js";
import { hashPassword, verifyPassword } from "../security/password.js";

const BCP47_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export function createAccountService({ repository, auditLogger, env = {} } = {}) {
  if (!repository) throw new Error("Account repository is required.");
  const addressSecret = env.accountAddressHmacSecret || env.authDeviceHmacSecret || "local-dev-address-hmac-secret";

  return {
    async getAccount(user) {
      const account = await repository.getAccount(user.id);
      if (!account) throw notFound("Account not found.");
      return { account: publicAccount(account) };
    },

    async updateAccount(user, input = {}, requestMeta = {}) {
      const expectedVersion = requireVersion(input.expected_version ?? input.expectedVersion);
      const current = await repository.getAccount(user.id);
      if (!current) throw notFound("Account not found.");
      const update = {
        userId: user.id,
        expectedVersion,
        displayName: optionalText(input.display_name ?? input.displayName ?? current.displayName, "display_name", 80),
        phone: optionalPhone(input.phone ?? current.phone),
        countryCode: optionalCountry(input.country_code ?? input.countryCode ?? current.countryCode),
        defaultLocale: requireLocale(input.default_locale ?? input.defaultLocale ?? current.defaultLocale),
        defaultCurrency: requireCurrency(input.default_currency ?? input.defaultCurrency ?? current.defaultCurrency)
      };
      await auditLogger?.write({
        actorType: "user", actorUserId: user.id, action: "account.profile.update",
        resourceType: "user", resourceId: user.id,
        metadata: { changed_fields: changedFields(current, update) }, requestId: requestMeta.requestId
      }, { critical: true });
      const updated = await repository.updateAccount(update);
      if (!updated) throw versionConflict();
      return { account: publicAccount(updated) };
    },

    async changePassword(user, input = {}, requestMeta = {}) {
      const expectedVersion = requireVersion(input.expected_version ?? input.expectedVersion);
      const current = await repository.getAccount(user.id);
      if (!current || !(await verifyPassword(String(input.current_password || ""), current.passwordHash))) {
        throw unauthorized("Current password is invalid.");
      }
      const newPassword = String(input.new_password || "");
      if (newPassword.length < 10 || newPassword.length > 128) {
        throw badRequest("New password must be 10-128 characters.", { field: "new_password" });
      }
      if (newPassword === String(input.current_password || "")) throw badRequest("New password must be different.");
      await auditLogger?.write({
        actorType: "user", actorUserId: user.id, action: "account.password.change",
        resourceType: "user", resourceId: user.id, metadata: { password: "[REDACTED]" }, requestId: requestMeta.requestId
      }, { critical: true });
      const updated = await repository.updatePasswordAndRevoke({
        userId: user.id, expectedVersion, passwordHash: await hashPassword(newPassword)
      });
      if (!updated) throw versionConflict();
      return { changed: true, sessions_revoked: true };
    },

    async listAddresses(user) {
      return { addresses: (await repository.listAddresses(user.id)).map(publicAddress) };
    },

    async createAddress(user, input = {}, requestMeta = {}) {
      const parsed = parseAddress(input, addressSecret);
      const address = await repository.createAddress({ userId: user.id, ...parsed });
      await auditAddress(auditLogger, user, address, "address.create", requestMeta);
      return { address: publicAddress(address) };
    },

    async updateAddress(user, addressId, input = {}, requestMeta = {}) {
      const expectedVersion = requireVersion(input.expected_version ?? input.expectedVersion);
      const existing = await repository.findAddress(user.id, addressId);
      if (!existing) throw notFound("Address not found.");
      const parsed = parseAddress({ ...publicAddress(existing), ...input }, addressSecret);
      const address = await repository.updateAddress({
        userId: user.id, addressId, expectedVersion, ...parsed
      });
      if (!address) throw versionConflict();
      await auditAddress(auditLogger, user, address, "address.update", requestMeta);
      return { address: publicAddress(address) };
    },

    async deleteAddress(user, addressId, expectedVersion, requestMeta = {}) {
      const existing = await repository.findAddress(user.id, addressId);
      if (!existing) throw notFound("Address not found.");
      await auditLogger?.write({
        actorType: "user", actorUserId: user.id, action: "address.delete",
        resourceType: "address", resourceId: addressId, metadata: {}, requestId: requestMeta.requestId
      }, { critical: true });
      const deleted = await repository.deleteAddress(user.id, addressId, requireVersion(expectedVersion));
      if (!deleted) throw versionConflict();
      return { deleted: true };
    },

    async getDeletionEligibility(user) {
      return repository.getDeletionEligibility(user.id);
    },

    async requestDeletion(user, requestMeta = {}) {
      const eligibility = await repository.getDeletionEligibility(user.id);
      if (!eligibility.eligible) throw deletionBlocked(eligibility.blockers);
      await auditLogger?.write({
        actorType: "user", actorUserId: user.id, action: "account.deletion.request",
        resourceType: "user", resourceId: user.id, metadata: {}, requestId: requestMeta.requestId
      }, { critical: true });
      const result = await repository.requestDeletion(user.id);
      if (result.notFound) throw notFound("Account not found.");
      if (result.blockers) throw deletionBlocked(result.blockers);
      return { deletion_request: publicDeletionRequest(result.request), existing: Boolean(result.existing) };
    },

    async processNextDeletion() {
      return repository.processNextDeletion();
    }
  };
}

function parseAddress(input, secret) {
  const address = {
    recipientName: requiredText(input.recipient_name ?? input.recipientName, "recipient_name", 120),
    phone: requiredText(input.phone, "phone", 32),
    countryCode: requireCountry(input.country_code ?? input.countryCode),
    region: optionalText(input.region, "region", 120),
    city: requiredText(input.city, "city", 120),
    postalCode: requiredText(input.postal_code ?? input.postalCode, "postal_code", 32),
    line1: requiredText(input.line1, "line1", 240),
    line2: optionalText(input.line2, "line2", 240),
    isDefault: Boolean(input.is_default ?? input.isDefault)
  };
  const normalized = [address.countryCode, address.region, address.city, address.postalCode, address.line1, address.line2]
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
  return {
    ...address,
    normalizedHash: createHmac("sha256", secret).update(normalized).digest("hex")
  };
}

export function publicAccount(user) {
  return {
    email: user.email, display_name: user.displayName || "", phone: user.phone,
    phone_verified: Boolean(user.phoneVerifiedAt), country_code: user.countryCode,
    default_locale: user.defaultLocale || "en-US", default_currency: user.defaultCurrency || "USD",
    status: user.status, email_verified: Boolean(user.emailVerifiedAt), version: Number(user.version || 1),
    deletion_requested_at: user.deletionRequestedAt, created_at: user.createdAt
  };
}

export function publicAddress(address) {
  return {
    id: address.id, recipient_name: address.recipientName, phone: address.phone,
    country_code: address.countryCode, region: address.region, city: address.city,
    postal_code: address.postalCode, line1: address.line1, line2: address.line2,
    is_default: address.isDefault, version: address.version,
    created_at: address.createdAt, updated_at: address.updatedAt
  };
}

function publicDeletionRequest(request) {
  return { id: request.id, status: request.status, requested_at: request.requestedAt, completed_at: request.completedAt };
}

function requireVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw badRequest("expected_version must be a positive integer.", { field: "expected_version" });
  return version;
}

function requireLocale(value) {
  const locale = String(value || "").trim();
  if (!BCP47_PATTERN.test(locale)) throw badRequest("default_locale must be a BCP 47 locale.");
  return locale;
}

function requireCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw badRequest("default_currency must be an ISO 4217 code.");
  return currency;
}

function requireCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  if (!COUNTRY_PATTERN.test(country)) throw badRequest("country_code must be an ISO 3166-1 alpha-2 code.");
  return country;
}

function optionalCountry(value) {
  return value ? requireCountry(value) : null;
}

function optionalPhone(value) {
  const phone = String(value || "").trim();
  if (phone.length > 32) throw badRequest("phone must be 32 characters or fewer.");
  return phone || null;
}

function requiredText(value, field, max) {
  const text = optionalText(value, field, max);
  if (!text) throw badRequest(`${field} is required.`, { field });
  return text;
}

function optionalText(value, field, max) {
  const text = String(value || "").trim();
  if (text.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`, { field });
  return text;
}

function changedFields(current, next) {
  const map = {
    display_name: [current.displayName, next.displayName], phone: [current.phone, next.phone],
    country_code: [current.countryCode, next.countryCode], default_locale: [current.defaultLocale, next.defaultLocale],
    default_currency: [current.defaultCurrency, next.defaultCurrency]
  };
  return Object.entries(map).filter(([, values]) => values[0] !== values[1]).map(([field]) => field);
}

function versionConflict() {
  return new AppError(409, "VERSION_CONFLICT", "The resource changed. Reload and try again.");
}

function deletionBlocked(blockers) {
  return new AppError(422, "ACCOUNT_DELETION_BLOCKED", "Account deletion requirements are not met.", { details: { blockers } });
}

async function auditAddress(auditLogger, user, address, action, requestMeta) {
  await auditLogger?.write({
    actorType: "user", actorUserId: user.id, action, resourceType: "address", resourceId: address.id,
    metadata: { address: "[REDACTED]", is_default: address.isDefault }, requestId: requestMeta.requestId
  }, { critical: true });
}
