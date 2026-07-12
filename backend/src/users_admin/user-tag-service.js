import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { matchesRule, validateRule } from "./group-rule.js";
import { maskEmail } from "./user-view.js";

// V2-09-04 — user tags & groups. Rules are versioned; dynamic recompute is
// idempotent; group member reads never expose sensitive fields (masked only).
export function createUserTagService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("User tag repository is required.");

  return {
    // ---- tags ----
    async createTag(adminUser, input, requestMeta = {}) {
      const code = requiredText(input?.code, "code", 60);
      const kind = input?.kind === "auto" ? "auto" : "manual";
      try {
        const tag = await repository.createTag({ code, name: optionalText(input?.name, "name", 120), kind, color: optionalText(input?.color, "color", 20), adminId: adminUser.id });
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_tag.create", resourceType: "user_tag", resourceId: tag.id, requestId: requestMeta.requestId }, { critical: false });
        return { tag };
      } catch (e) { if (e.code === "TAG_EXISTS") throw conflict("A tag with this code already exists.", { code: "tag_exists" }); throw e; }
    },
    async listTags() { return { tags: await repository.listTags() }; },

    async assignTag(adminUser, input, requestMeta = {}) {
      const userId = requiredText(input?.user_id, "user_id", 64);
      const tag = await repository.findTagByCode(requiredText(input?.tag_code, "tag_code", 60));
      if (!tag) throw notFound("Tag not found.");
      const res = await repository.assignTag({ userId, tagId: tag.id, source: "manual", adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_tag.assign", resourceType: "user", resourceId: userId, metadata: { tag: tag.code }, requestId: requestMeta.requestId }, { critical: false });
      return { assigned: res.created, tag_code: tag.code };
    },
    async unassignTag(adminUser, input, requestMeta = {}) {
      const userId = requiredText(input?.user_id, "user_id", 64);
      const tag = await repository.findTagByCode(requiredText(input?.tag_code, "tag_code", 60));
      if (!tag) throw notFound("Tag not found.");
      const res = await repository.unassignTag({ userId, tagId: tag.id });
      return { removed: res.removed };
    },
    async listUserTags(userId) { return { tags: await repository.listUserTags(userId) }; },

    // ---- groups ----
    async createGroup(adminUser, input, requestMeta = {}) {
      const code = requiredText(input?.code, "code", 60);
      const kind = input?.kind === "dynamic" ? "dynamic" : "static";
      let rule = {};
      if (kind === "dynamic") {
        rule = input?.rule || {};
        const v = validateRule(rule);
        if (!v.ok) throw badRequest(`Invalid group rule: ${v.reason}`, { field: "rule" });
      }
      try {
        const group = await repository.createGroup({ code, name: optionalText(input?.name, "name", 120), kind, rule, adminId: adminUser.id });
        await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_group.create", resourceType: "user_group", resourceId: group.id, requestId: requestMeta.requestId }, { critical: false });
        return { group };
      } catch (e) { if (e.code === "GROUP_EXISTS") throw conflict("A group with this code already exists.", { code: "group_exists" }); throw e; }
    },
    async listGroups() { return { groups: await repository.listGroups() }; },

    async updateGroupRule(adminUser, groupId, input, requestMeta = {}) {
      const group = await repository.findGroupById(groupId);
      if (!group) throw notFound("Group not found.");
      if (group.kind !== "dynamic") throw conflict("Only a dynamic group has a rule.", { code: "not_dynamic" });
      const rule = input?.rule || {};
      const v = validateRule(rule);
      if (!v.ok) throw badRequest(`Invalid group rule: ${v.reason}`, { field: "rule" });
      const updated = await repository.updateGroupRule(groupId, rule); // bumps rule_version
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_group.rule_update", resourceType: "user_group", resourceId: groupId, metadata: { rule_version: updated.ruleVersion }, requestId: requestMeta.requestId }, { critical: false });
      return { group: updated };
    },

    async addStaticMember(adminUser, groupId, input, requestMeta = {}) {
      const group = await repository.findGroupById(groupId);
      if (!group) throw notFound("Group not found.");
      if (group.kind !== "static") throw conflict("Members can only be added to a static group.", { code: "not_static" });
      const res = await repository.addStaticMember({ groupId, userId: requiredText(input?.user_id, "user_id", 64) });
      return { added: res.created };
    },
    async removeMember(adminUser, groupId, input) {
      const res = await repository.removeMember({ groupId, userId: requiredText(input?.user_id, "user_id", 64) });
      return { removed: res.removed };
    },

    // Group members — masked identifiers only (ops cannot export PII via groups).
    async listMembers(groupId) {
      const rows = await repository.listMembers(groupId);
      return { members: rows.map((m) => ({ user_id: m.userId, email_masked: maskEmail(m.email), status: m.status })) };
    },

    // ---- V2-09-04 dynamic recompute (idempotent) ----
    async recomputeGroup(adminUser, groupId, requestMeta = {}) {
      const group = await repository.findGroupById(groupId);
      if (!group) throw notFound("Group not found.");
      if (group.kind !== "dynamic") throw conflict("Only a dynamic group can be recomputed.", { code: "not_dynamic" });
      const candidates = await repository.listCandidateUsers();
      const matchedIds = candidates.filter((u) => matchesRule(u, group.rule)).map((u) => u.id);
      const result = await repository.materializeDynamicMembers({ groupId, userIds: matchedIds, ruleVersion: group.ruleVersion });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "user_group.recompute", resourceType: "user_group", resourceId: groupId, metadata: { ...result, rule_version: group.ruleVersion, candidates: candidates.length }, requestId: requestMeta.requestId }, { critical: false });
      return { group_id: groupId, rule_version: group.ruleVersion, ...result, candidates_scanned: candidates.length };
    }
  };
}
