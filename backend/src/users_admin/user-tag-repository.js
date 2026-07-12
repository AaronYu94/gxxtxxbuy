import { getDbPool } from "../db/pool.js";

// V2-09-04 — user tags & groups (manual/auto tags, static/dynamic groups).
export function createPgUserTagRepository(env) {
  const pool = () => getDbPool(env);

  return {
    // ---- tags ----
    async createTag({ code, name, kind, color, adminId }) {
      try {
        const r = await pool().query(
          "insert into user_tags (code, name, kind, color, created_by_admin_id) values ($1, $2, $3, $4, $5) returning *",
          [code, name || "", kind || "manual", color || "", adminId || null]
        );
        return normalizeTag(r.rows[0]);
      } catch (e) { if (e.code === "23505") { const err = new Error("dup"); err.code = "TAG_EXISTS"; throw err; } throw e; }
    },
    async listTags() { return (await pool().query("select * from user_tags order by code asc")).rows.map(normalizeTag); },
    async findTagByCode(code) { const r = await pool().query("select * from user_tags where code = $1", [code]); return normalizeTag(r.rows[0]); },

    async assignTag({ userId, tagId, source, adminId }) {
      const r = await pool().query(
        `insert into user_tag_assignments (user_id, tag_id, source, assigned_by_admin_id) values ($1, $2, $3, $4)
         on conflict (user_id, tag_id) do nothing returning *`,
        [userId, tagId, source || "manual", adminId || null]
      );
      return { created: r.rowCount > 0 };
    },
    async unassignTag({ userId, tagId }) {
      const r = await pool().query("delete from user_tag_assignments where user_id = $1 and tag_id = $2", [userId, tagId]);
      return { removed: r.rowCount > 0 };
    },
    async listUserTags(userId) {
      const r = await pool().query(
        "select t.code from user_tag_assignments a join user_tags t on t.id = a.tag_id where a.user_id = $1 order by t.code", [userId]
      );
      return r.rows.map((x) => x.code);
    },

    // ---- groups ----
    async createGroup({ code, name, kind, rule, adminId }) {
      try {
        const r = await pool().query(
          "insert into user_groups (code, name, kind, rule) values ($1, $2, $3, $4) returning *",
          [code, name || "", kind, JSON.stringify(rule || {})]
        );
        return normalizeGroup(r.rows[0]);
      } catch (e) { if (e.code === "23505") { const err = new Error("dup"); err.code = "GROUP_EXISTS"; throw err; } throw e; }
    },
    async findGroupById(id) { const r = await pool().query("select * from user_groups where id = $1", [id]); return normalizeGroup(r.rows[0]); },
    async listGroups() { return (await pool().query("select * from user_groups order by code asc")).rows.map(normalizeGroup); },
    async updateGroupRule(id, rule) {
      const r = await pool().query(
        "update user_groups set rule = $2, rule_version = rule_version + 1 where id = $1 returning *", [id, JSON.stringify(rule || {})]
      );
      return normalizeGroup(r.rows[0]);
    },

    async addStaticMember({ groupId, userId }) {
      const r = await pool().query(
        `insert into user_group_members (group_id, user_id, source) values ($1, $2, 'static')
         on conflict (group_id, user_id) do nothing returning *`, [groupId, userId]
      );
      return { created: r.rowCount > 0 };
    },
    async removeMember({ groupId, userId }) {
      const r = await pool().query("delete from user_group_members where group_id = $1 and user_id = $2", [groupId, userId]);
      return { removed: r.rowCount > 0 };
    },
    async listMembers(groupId, limit = 100) {
      const r = await pool().query(
        `select m.user_id, u.email, u.status from user_group_members m join users u on u.id = m.user_id
           where m.group_id = $1 order by m.created_at asc limit $2`, [groupId, Math.min(limit, 200)]
      );
      return r.rows.map((x) => ({ userId: x.user_id, email: x.email, status: x.status }));
    },

    // Candidate users for a dynamic recompute (bounded), each with their tag codes.
    async listCandidateUsers(limit = 1000) {
      const r = await pool().query(
        `select u.id, u.status, u.country_code,
            coalesce(array_agg(t.code) filter (where t.code is not null), '{}') tags
           from users u
           left join user_tag_assignments a on a.user_id = u.id
           left join user_tags t on t.id = a.tag_id
           where u.deleted_at is null
           group by u.id order by u.created_at desc limit $1`, [limit]
      );
      return r.rows.map((x) => ({ id: x.id, status: x.status, countryCode: x.country_code, tags: x.tags || [] }));
    },

    // Idempotent materialization of a dynamic group's membership to `userIds`.
    async materializeDynamicMembers({ groupId, userIds, ruleVersion }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const existing = (await client.query("select user_id from user_group_members where group_id = $1 and source = 'dynamic'", [groupId])).rows.map((r) => r.user_id);
        const target = new Set(userIds);
        const current = new Set(existing);
        const toAdd = userIds.filter((id) => !current.has(id));
        const toRemove = existing.filter((id) => !target.has(id));
        for (const id of toAdd) {
          await client.query("insert into user_group_members (group_id, user_id, source) values ($1, $2, 'dynamic') on conflict (group_id, user_id) do nothing", [groupId, id]);
        }
        for (const id of toRemove) {
          await client.query("delete from user_group_members where group_id = $1 and user_id = $2 and source = 'dynamic'", [groupId, id]);
        }
        await client.query("update user_groups set last_recomputed_at = now(), last_recomputed_version = $2 where id = $1", [groupId, ruleVersion]);
        await client.query("commit");
        return { added: toAdd.length, removed: toRemove.length, total: userIds.length };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeTag(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, kind: row.kind, color: row.color, createdAt: row.created_at };
}
export function normalizeGroup(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, kind: row.kind, rule: row.rule || {}, ruleVersion: row.rule_version, enabled: row.enabled, lastRecomputedAt: row.last_recomputed_at, lastRecomputedVersion: row.last_recomputed_version, createdAt: row.created_at };
}
