import { getDbPool } from "../db/pool.js";

export function createPgContentRepository(env) {
  return {
    async createStory(input) {
      const result = await getDbPool(env).query(
        `insert into haul_stories (user_id, parcel_id, title, body, privacy_level, review_status)
         values ($1, $2, $3, $4, $5, 'pending')
         returning *`,
        [input.userId, input.parcelId || null, input.title, input.body || "", input.privacyLevel]
      );
      return normalizeStory(result.rows[0]);
    },

    async findStoryById(id) {
      const result = await getDbPool(env).query("select * from haul_stories where id = $1 limit 1", [id]);
      return normalizeStory(result.rows[0]);
    },

    async listUserStories(userId) {
      const result = await getDbPool(env).query(
        "select * from haul_stories where user_id = $1 order by created_at desc",
        [userId]
      );
      return result.rows.map(normalizeStory);
    },

    async listReviewQueue({ status = "pending", limit = 25, offset = 0 } = {}) {
      const pool = getDbPool(env);
      const [rows, count] = await Promise.all([
        pool.query(
          `select * from haul_stories where review_status = $1 order by created_at asc limit $2 offset $3`,
          [status, limit, offset]
        ),
        pool.query("select count(*)::int as total from haul_stories where review_status = $1", [status])
      ]);
      return { stories: rows.rows.map(normalizeStory), total: count.rows[0].total };
    },

    async reviewStory(input) {
      const result = await getDbPool(env).query(
        `update haul_stories
         set review_status = $2,
             rejection_reason = $3,
             reviewed_by_admin_user_id = $4,
             reviewed_at = now()
         where id = $1
         returning *`,
        [input.id, input.reviewStatus, input.rejectionReason || "", input.reviewedByAdminUserId || null]
      );
      return normalizeStory(result.rows[0]);
    },

    async withdrawStory(userId, id) {
      const result = await getDbPool(env).query(
        `update haul_stories
         set review_status = 'withdrawn'
         where id = $1 and user_id = $2 and review_status <> 'withdrawn'
         returning *`,
        [id, userId]
      );
      return normalizeStory(result.rows[0]);
    }
  };
}

export function normalizeStory(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    parcelId: row.parcel_id ?? row.parcelId ?? null,
    title: row.title,
    body: row.body ?? "",
    privacyLevel: row.privacy_level ?? row.privacyLevel,
    reviewStatus: row.review_status ?? row.reviewStatus,
    rejectionReason: row.rejection_reason ?? row.rejectionReason ?? "",
    reviewedByAdminUserId: row.reviewed_by_admin_user_id ?? row.reviewedByAdminUserId ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}
