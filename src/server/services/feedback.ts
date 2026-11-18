import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import DOMPurify from "isomorphic-dompurify";

export async function submitFeedback(
  tenantId: string,
  input: { customerId: string; rating: number; comment?: string | null }
) {
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const sanitizedComment = input.comment
    ? DOMPurify.sanitize(input.comment.trim(), { ALLOWED_TAGS: [] })
    : null;
  const feedback = await db.$transaction(async (tx) => {
    const created = await tx.feedback.create({
      data: { tenantId, customerId: input.customerId, rating, comment: sanitizedComment },
    });
    await publish(tx, {
      tenantId,
      type: EventTypes.FeedbackSubmitted,
      payload: { feedbackId: created.id, customerId: input.customerId, rating },
      dedupeKey: `feedback:${created.id}`,
    });
    return created;
  });
  return feedback;
}

export async function listFeedback(
  tenantId: string,
  opts: { cursor?: string | null; limit?: number; minRating?: number | null; maxRating?: number | null; status?: string | null; customerId?: string | null }
) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  if (opts.customerId) where.customerId = opts.customerId;
  if (opts.minRating || opts.maxRating) {
    where.rating = {
      ...(opts.minRating ? { gte: opts.minRating } : {}),
      ...(opts.maxRating ? { lte: opts.maxRating } : {}),
    };
  }
  const rows = await db.feedback.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { customer: { select: { id: true, name: true, email: true } } },
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null,
  };
}

export async function setFeedbackStatus(tenantId: string, feedbackId: string, status: string) {
  const updated = await db.feedback.updateMany({ where: { id: feedbackId, tenantId }, data: { status } });
  return updated.count > 0;
}

export async function markFollowUpDone(tenantId: string, feedbackId: string) {
  const updated = await db.feedback.updateMany({ where: { id: feedbackId, tenantId }, data: { followUpStatus: "done", status: "actioned" } });
  return updated.count > 0;
}
