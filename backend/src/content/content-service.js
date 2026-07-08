import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";

const PRIVACY_LEVELS = ["private", "unlisted", "public"];
const REVIEW_STATUSES = ["pending", "approved", "rejected", "hidden", "withdrawn"];
const REVIEW_ACTIONS = { approve: "approved", reject: "rejected", hide: "hidden" };

export function createContentService({ repository, auditLogger = null } = {}) {
  if (!repository) throw new Error("Content repository is required.");

  return {
    // B7-07: create a story. Only a whitelist of fields is accepted from the user and
    // the story always starts pending review. Public is not reachable without moderation.
    async createStory(user, input = {}, requestMeta = {}) {
      const title = requiredText(input.title, "title", 160);
      const body = optionalText(input.body, "body", 4000);
      const privacyLevel = normalizePrivacy(input.privacy_level ?? input.privacyLevel);
      const story = await repository.createStory({
        userId: user.id,
        parcelId: optionalText(input.parcel_id ?? input.parcelId, "parcel_id", 80) || null,
        title,
        body,
        privacyLevel
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "content.story.create",
        resourceType: "haul_story",
        resourceId: story.id,
        metadata: { privacy_level: privacyLevel },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { story: publicStory(story) };
    },

    async listMyStories(user) {
      const stories = await repository.listUserStories(user.id);
      return { stories: stories.map(publicStory) };
    },

    // B7-09: a user can withdraw their own story at any time.
    async withdrawStory(user, storyId, requestMeta = {}) {
      const story = await repository.findStoryById(requiredText(storyId, "story_id", 80));
      if (!story || story.userId !== user.id) throw notFound("Story not found.");
      const withdrawn = await repository.withdrawStory(user.id, story.id);
      if (!withdrawn) {
        return { story: publicStory(story), existing: true };
      }
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "content.story.withdraw",
        resourceType: "haul_story",
        resourceId: story.id,
        requestId: requestMeta.requestId
      }, { critical: false });
      return { story: publicStory(withdrawn), existing: false };
    },

    // B7-08: moderation queue, paginated, review permission required at the route.
    async listReviewQueue(query = {}) {
      const status = normalizeReviewStatus(query.status || "pending");
      const limit = clampLimit(query.limit);
      const offset = clampOffset(query.offset);
      const { stories, total } = await repository.listReviewQueue({ status, limit, offset });
      return {
        stories: stories.map(adminStory),
        pagination: { total, limit, offset, has_more: offset + stories.length < total }
      };
    },

    // B7-09: approve / reject / hide, always with an audit trail.
    async reviewStory(adminUser, storyId, input = {}, requestMeta = {}) {
      const action = String(input.action || "").trim().toLowerCase();
      if (!REVIEW_ACTIONS[action]) {
        throw badRequest("action must be approve, reject, or hide.", { field: "action" });
      }
      const story = await repository.findStoryById(requiredText(storyId, "story_id", 80));
      if (!story) throw notFound("Story not found.");
      if (story.reviewStatus === "withdrawn") {
        throw conflict("Story was withdrawn by its author.", { code: "STORY_WITHDRAWN" });
      }
      const rejectionReason = action === "approve"
        ? ""
        : requiredText(input.reason, "reason", 500);
      const reviewed = await repository.reviewStory({
        id: story.id,
        reviewStatus: REVIEW_ACTIONS[action],
        rejectionReason,
        reviewedByAdminUserId: adminUser.id
      });
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: `content.story.${action}`,
        resourceType: "haul_story",
        resourceId: story.id,
        metadata: { review_status: reviewed.reviewStatus, reason: rejectionReason },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { story: adminStory(reviewed) };
    }
  };
}

export function publicStory(story) {
  return {
    id: story.id,
    parcel_id: story.parcelId,
    title: story.title,
    body: story.body,
    privacy_level: story.privacyLevel,
    review_status: story.reviewStatus,
    rejection_reason: story.rejectionReason,
    created_at: story.createdAt,
    updated_at: story.updatedAt
  };
}

function adminStory(story) {
  return {
    ...publicStory(story),
    user_id: story.userId,
    reviewed_by_admin_user_id: story.reviewedByAdminUserId,
    reviewed_at: story.reviewedAt
  };
}

function normalizePrivacy(value) {
  const level = String(value || "private").trim().toLowerCase();
  if (!PRIVACY_LEVELS.includes(level)) {
    throw badRequest("privacy_level is invalid.", { field: "privacy_level", allowed: PRIVACY_LEVELS });
  }
  return level;
}

function normalizeReviewStatus(value) {
  const status = String(value || "pending").trim().toLowerCase();
  if (!REVIEW_STATUSES.includes(status)) {
    throw badRequest("status is invalid.", { field: "status", allowed: REVIEW_STATUSES });
  }
  return status;
}

function clampLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 25;
  return Math.min(Math.floor(limit), 100);
}

function clampOffset(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
