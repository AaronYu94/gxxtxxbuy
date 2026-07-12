import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { tailorOverview, tabsForRole, roleCanSeeTab, maskEmail } from "./user-view.js";

// V2-09-01/02/03 — restricted user search, role-tailored detail, CS-assisted edit.
export function createUserAdminService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("User admin repository is required.");

  function primaryRole(adminRoles) {
    return Array.isArray(adminRoles) && adminRoles.length ? adminRoles[0] : "support_agent";
  }

  return {
    // ---- V2-09-01 restricted search ----
    // Exactly one of id/email/order_no/parcel_no (exact) OR q (bounded prefix).
    // An empty request is a 400 (no "list all users").
    async search(adminUser, adminRoles, query = {}, requestMeta = {}) {
      const id = optionalText(query.id, "id", 64);
      const email = optionalText(query.email, "email", 320);
      const orderNo = optionalText(query.order_no, "order_no", 64);
      const parcelNo = optionalText(query.parcel_no, "parcel_no", 64);
      const q = optionalText(query.q, "q", 120);

      if (!id && !email && !orderNo && !parcelNo && !q) {
        throw badRequest("A search identifier is required (id, email, order_no, parcel_no, or q).", { code: "empty_query" });
      }

      let matches = [];
      let matchedBy = null;
      if (id) { matchedBy = "id"; matches = [await repository.findById(id)]; }
      else if (email) { matchedBy = "email"; matches = [await repository.findByEmail(email)]; }
      else if (orderNo) { matchedBy = "order_no"; matches = [await repository.findByOrderNo(orderNo)]; }
      else if (parcelNo) { matchedBy = "parcel_no"; matches = [await repository.findByParcelNo(parcelNo)]; }
      else { matchedBy = "prefix"; matches = await repository.searchByPrefix(q, Number(query.limit) || 20); }
      matches = matches.filter(Boolean);

      // Looking up a specific user is audited (sensitive-user access trail).
      if (matchedBy !== "prefix" && matches.length) {
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_admin.lookup", resourceType: "user", resourceId: matches[0].id, metadata: { matched_by: matchedBy }, requestId: requestMeta.requestId }, { critical: false });
      }
      return {
        matched_by: matchedBy,
        results: matches.map((u) => ({ id: u.id, email_masked: maskEmail(u.email), display_name: u.displayName || "", status: u.status }))
      };
    },

    // ---- V2-09-02 role-tailored detail ----
    async getDetail(adminUser, adminRoles, userId, query = {}, requestMeta = {}) {
      const role = primaryRole(adminRoles);
      const user = await repository.findById(userId);
      if (!user) throw notFound("User not found.");
      const tabs = tabsForRole(role);
      const requestedTab = optionalText(query.tab, "tab", 40) || "overview";
      if (!roleCanSeeTab(role, requestedTab)) {
        throw forbidden(`Your role cannot view the ${requestedTab} tab.`);
      }

      const detail = { user_id: user.id, tabs, overview: tailorOverview(user, role) };
      if (requestedTab === "overview") {
        detail.counts = await repository.userCounts(userId);
      } else if (requestedTab === "orders") {
        detail.orders = await repository.recentOrders(userId);
      } else if (requestedTab === "wallet") {
        detail.wallet = { available_cny_minor: await repository.walletBalance(userId) };
      }
      // Other tabs return their heading + counts only in this slice (data lives in
      // their own domain endpoints); the role gate above is the load-bearing part.
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_admin.detail", resourceType: "user", resourceId: userId, metadata: { tab: requestedTab }, requestId: requestMeta.requestId }, { critical: false });
      return detail;
    },

    // ---- V2-09-03 CS-assisted profile edit ----
    async assistEdit(adminUser, adminRoles, userId, input = {}, requestMeta = {}) {
      // Identity verification is mandatory and recorded (who was verified, how).
      const verification = optionalText(input?.identity_verification, "identity_verification", 500);
      if (!verification) throw badRequest("An identity-verification note is required to assist a user.", { field: "identity_verification" });

      const columns = {};
      if (input.phone !== undefined) columns.phone = optionalText(input.phone, "phone", 40);
      if (input.country_code !== undefined) columns.country_code = optionalText(input.country_code, "country_code", 2);
      if (input.default_currency !== undefined) columns.default_currency = optionalText(input.default_currency, "default_currency", 8);
      if (input.default_locale !== undefined) columns.default_locale = optionalText(input.default_locale, "default_locale", 12);
      const email = input.email !== undefined ? requiredText(input.email, "email", 320) : null;
      if (Object.keys(columns).length === 0 && !email) {
        throw badRequest("Nothing to update.", { code: "empty_update" });
      }

      const result = await repository.assistUpdateProfile(userId, { columns, email }, input.expected_version != null ? Number(input.expected_version) : null);
      if (result.notFound) throw notFound("User not found.");
      if (result.versionConflict) throw conflict("User changed; reload and retry.", { code: "version_conflict" });
      if (result.locked) throw conflict("A locked account's profile cannot be edited.", { code: "account_locked", status: result.status });
      if (result.emailTaken) throw conflict("That email is already in use.", { code: "email_taken" });

      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "user_admin.assist_edit",
        resourceType: "user", resourceId: userId,
        metadata: { fields: Object.keys(columns).concat(email ? ["email"] : []), email_reverify: result.emailChanged, identity_verification: verification },
        requestId: requestMeta.requestId
      }, { critical: true });
      return {
        user_id: userId,
        email_reverification_required: Boolean(result.emailChanged),
        overview: tailorOverview(result.user, primaryRole(adminRoles))
      };
    }
  };
}
