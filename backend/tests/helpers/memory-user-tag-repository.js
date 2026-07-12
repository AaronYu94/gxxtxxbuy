import { randomUUID } from "node:crypto";

// In-memory double for the user-tag/group repository (V2-09-04).
export class MemoryUserTagRepository {
  constructor() {
    this.tags = new Map();          // id -> tag
    this.assignments = [];          // { userId, tagId, source }
    this.groups = new Map();        // id -> group
    this.members = [];              // { groupId, userId, source }
    this.candidates = [];           // seeded users {id,status,countryCode,tags}
  }

  seedCandidate(u) { this.candidates.push({ id: u.id, status: u.status || "normal", countryCode: u.countryCode || "", tags: u.tags || [] }); }

  async createTag({ code, name, kind, color, adminId }) {
    for (const t of this.tags.values()) if (t.code === code) { const e = new Error("dup"); e.code = "TAG_EXISTS"; throw e; }
    const tag = { id: randomUUID(), code, name: name || "", kind: kind || "manual", color: color || "", createdAt: new Date().toISOString() };
    this.tags.set(tag.id, tag);
    return { ...tag };
  }
  async listTags() { return [...this.tags.values()].sort((a, b) => a.code.localeCompare(b.code)); }
  async findTagByCode(code) { for (const t of this.tags.values()) if (t.code === code) return { ...t }; return null; }
  async assignTag({ userId, tagId, source }) {
    if (this.assignments.some((a) => a.userId === userId && a.tagId === tagId)) return { created: false };
    this.assignments.push({ userId, tagId, source: source || "manual" });
    const tag = this.tags.get(tagId);
    const cand = this.candidates.find((c) => c.id === userId);
    if (cand && tag && !cand.tags.includes(tag.code)) cand.tags.push(tag.code);
    return { created: true };
  }
  async unassignTag({ userId, tagId }) {
    const n = this.assignments.length;
    this.assignments = this.assignments.filter((a) => !(a.userId === userId && a.tagId === tagId));
    return { removed: this.assignments.length < n };
  }
  async listUserTags(userId) { return this.assignments.filter((a) => a.userId === userId).map((a) => this.tags.get(a.tagId)?.code).filter(Boolean); }

  async createGroup({ code, name, kind, rule }) {
    for (const g of this.groups.values()) if (g.code === code) { const e = new Error("dup"); e.code = "GROUP_EXISTS"; throw e; }
    const group = { id: randomUUID(), code, name: name || "", kind, rule: rule || {}, ruleVersion: 1, enabled: true, lastRecomputedAt: null, lastRecomputedVersion: null, createdAt: new Date().toISOString() };
    this.groups.set(group.id, group);
    return { ...group };
  }
  async findGroupById(id) { const g = this.groups.get(id); return g ? { ...g } : null; }
  async listGroups() { return [...this.groups.values()]; }
  async updateGroupRule(id, rule) { const g = this.groups.get(id); g.rule = rule; g.ruleVersion += 1; return { ...g }; }

  async addStaticMember({ groupId, userId }) {
    if (this.members.some((m) => m.groupId === groupId && m.userId === userId)) return { created: false };
    this.members.push({ groupId, userId, source: "static" });
    return { created: true };
  }
  async removeMember({ groupId, userId }) {
    const n = this.members.length;
    this.members = this.members.filter((m) => !(m.groupId === groupId && m.userId === userId));
    return { removed: this.members.length < n };
  }
  async listMembers(groupId) {
    return this.members.filter((m) => m.groupId === groupId).map((m) => ({ userId: m.userId, email: `${m.userId}@x.com`, status: "normal" }));
  }
  async listCandidateUsers() { return this.candidates.map((c) => ({ ...c, tags: [...c.tags] })); }
  async materializeDynamicMembers({ groupId, userIds, ruleVersion }) {
    const existing = this.members.filter((m) => m.groupId === groupId && m.source === "dynamic").map((m) => m.userId);
    const target = new Set(userIds);
    const current = new Set(existing);
    const toAdd = userIds.filter((id) => !current.has(id));
    const toRemove = existing.filter((id) => !target.has(id));
    for (const id of toAdd) this.members.push({ groupId, userId: id, source: "dynamic" });
    this.members = this.members.filter((m) => !(m.groupId === groupId && m.source === "dynamic" && toRemove.includes(m.userId)));
    const g = this.groups.get(groupId);
    if (g) { g.lastRecomputedAt = new Date().toISOString(); g.lastRecomputedVersion = ruleVersion; }
    return { added: toAdd.length, removed: toRemove.length, total: userIds.length };
  }
}
