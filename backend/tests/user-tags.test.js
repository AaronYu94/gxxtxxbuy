import assert from "node:assert/strict";
import test from "node:test";
import { matchesRule, validateRule } from "../src/users_admin/group-rule.js";
import { createUserTagService } from "../src/users_admin/user-tag-service.js";
import { MemoryUserTagRepository } from "./helpers/memory-user-tag-repository.js";

const ADMIN = { id: "99999999-9999-9999-9999-999999999999" };

// ---- pure rule engine ----
test("a rule is a conjunction over allowed fields", () => {
  const rule = { all: [{ field: "status", eq: "normal" }, { field: "tag", has: "vip" }] };
  assert.equal(matchesRule({ status: "normal", tags: ["vip"] }, rule), true);
  assert.equal(matchesRule({ status: "normal", tags: [] }, rule), false);
  assert.equal(matchesRule({ status: "banned", tags: ["vip"] }, rule), false);
});

test("an empty rule matches no one and fails validation", () => {
  assert.equal(matchesRule({ status: "normal" }, { all: [] }), false);
  assert.equal(validateRule({ all: [] }).ok, false);
  assert.equal(validateRule({ all: [{ field: "ip", eq: "1.2.3.4" }] }).ok, false); // unsupported field
});

function build() {
  const repository = new MemoryUserTagRepository();
  const svc = createUserTagService({ repository });
  return { repository, svc };
}

test("manual tag create + assign + list", async () => {
  const { repository, svc } = build();
  repository.seedCandidate({ id: "u1", status: "normal", countryCode: "US" });
  await svc.createTag(ADMIN, { code: "vip", name: "VIP" });
  const res = await svc.assignTag(ADMIN, { user_id: "u1", tag_code: "vip" });
  assert.equal(res.assigned, true);
  // Re-assign is idempotent.
  assert.equal((await svc.assignTag(ADMIN, { user_id: "u1", tag_code: "vip" })).assigned, false);
  assert.deepEqual(await svc.listUserTags("u1").then((r) => r.tags), ["vip"]);
});

test("a dynamic group needs a valid rule; a static group takes explicit members", async () => {
  const { svc } = build();
  await assert.rejects(() => svc.createGroup(ADMIN, { code: "bad", kind: "dynamic", rule: { all: [] } }), (e) => e.statusCode === 400);
  const stat = await svc.createGroup(ADMIN, { code: "manual-grp", kind: "static" });
  const added = await svc.addStaticMember(ADMIN, stat.group.id, { user_id: "u1" });
  assert.equal(added.added, true);
});

test("dynamic recompute materializes members idempotently and versions rules", async () => {
  const { repository, svc } = build();
  await svc.createTag(ADMIN, { code: "vip" });
  repository.seedCandidate({ id: "u1", status: "normal", countryCode: "US", tags: ["vip"] });
  repository.seedCandidate({ id: "u2", status: "normal", countryCode: "US", tags: [] });
  repository.seedCandidate({ id: "u3", status: "banned", countryCode: "US", tags: ["vip"] });

  const grp = (await svc.createGroup(ADMIN, { code: "vip-us", kind: "dynamic", rule: { all: [{ field: "status", eq: "normal" }, { field: "tag", has: "vip" }] } })).group;
  const first = await svc.recomputeGroup(ADMIN, grp.id);
  assert.equal(first.added, 1); // only u1
  assert.equal(first.total, 1);

  // Idempotent: a second recompute with no change adds/removes nothing.
  const second = await svc.recomputeGroup(ADMIN, grp.id);
  assert.equal(second.added, 0);
  assert.equal(second.removed, 0);

  // Widen the rule (bumps version) → u2 now qualifies.
  const updated = await svc.updateGroupRule(ADMIN, grp.id, { rule: { all: [{ field: "status", eq: "normal" }] } });
  assert.equal(updated.group.ruleVersion, 2);
  const third = await svc.recomputeGroup(ADMIN, grp.id);
  assert.equal(third.added, 1); // u2 joins
  assert.equal(third.rule_version, 2);
});

test("group members are returned masked (no PII export)", async () => {
  const { svc } = build();
  const grp = (await svc.createGroup(ADMIN, { code: "g", kind: "static" })).group;
  await svc.addStaticMember(ADMIN, grp.id, { user_id: "u1" });
  const members = (await svc.listMembers(grp.id)).members;
  assert.ok(members[0].email_masked.includes("*") || members[0].email_masked.length <= 8);
  assert.equal(members[0].email, undefined); // never the raw email
});
