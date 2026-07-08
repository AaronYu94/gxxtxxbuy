import { randomUUID } from "node:crypto";
import { normalizeStory } from "../../src/content/content-repository.js";

export class MemoryContentRepository {
  constructor() {
    this.stories = new Map();
  }

  async createStory(input) {
    const now = new Date().toISOString();
    const story = normalizeStory({
      id: randomUUID(),
      user_id: input.userId,
      parcel_id: input.parcelId || null,
      title: input.title,
      body: input.body || "",
      privacy_level: input.privacyLevel,
      review_status: "pending",
      created_at: now,
      updated_at: now
    });
    this.stories.set(story.id, story);
    return clone(story);
  }

  async findStoryById(id) {
    return clone(this.stories.get(id));
  }

  async listUserStories(userId) {
    return Array.from(this.stories.values())
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(clone);
  }

  async listReviewQueue({ status = "pending", limit = 25, offset = 0 } = {}) {
    const all = Array.from(this.stories.values())
      .filter((entry) => entry.reviewStatus === status)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { stories: all.slice(offset, offset + limit).map(clone), total: all.length };
  }

  async reviewStory(input) {
    const story = this.stories.get(input.id);
    if (!story) return null;
    story.reviewStatus = input.reviewStatus;
    story.rejectionReason = input.rejectionReason || "";
    story.reviewedByAdminUserId = input.reviewedByAdminUserId || null;
    story.reviewedAt = new Date().toISOString();
    story.updatedAt = story.reviewedAt;
    return clone(story);
  }

  async withdrawStory(userId, id) {
    const story = this.stories.get(id);
    if (!story || story.userId !== userId || story.reviewStatus === "withdrawn") return null;
    story.reviewStatus = "withdrawn";
    story.updatedAt = new Date().toISOString();
    return clone(story);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
