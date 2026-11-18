import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { parseJson } from "@/server/lib/json";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";

/** Outbox event browser (queue inspector). */
export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const where: Record<string, unknown> = { tenantId: ctx.tenant.id };
    if (status) where.status = status;
    if (type) where.type = type;

    const [events, counts] = await Promise.all([
      db.outboxEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(url.searchParams.get("limit") ?? 40), 100),
      }),
      db.outboxEvent.groupBy({ by: ["status"], where: { tenantId: ctx.tenant.id }, _count: true }),
    ]);

    return jsonOk({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        attempts: e.attempts,
        maxAttempts: e.maxAttempts,
        availableAt: e.availableAt,
        processedAt: e.processedAt,
        lastError: e.lastError,
        dedupeKey: e.dedupeKey,
        payload: parseJson<Record<string, unknown>>(e.payload, {}),
        createdAt: e.createdAt,
      })),
      counts: counts.map((c) => ({ status: c.status, count: c._count })),
    });
  }, { name: "events-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { eventId?: string; action?: string };
    if (!body.eventId) return jsonError("bad_request", "eventId is required", 400);
    const event = await db.outboxEvent.findFirst({ where: { id: body.eventId, tenantId: ctx.tenant.id } });
    if (!event) return jsonError("not_found", "Event not found", 404);

    if (body.action === "retry") {
      if (event.status !== "dead") return jsonError("bad_request", "Only dead-lettered events can be retried", 400);
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: "pending", attempts: 0, availableAt: new Date(), lastError: null },
      });
      return jsonOk({ ok: true, message: "Event requeued from the dead-letter queue" });
    }
    return jsonError("bad_request", "Unknown action", 400);
  }, { name: "events-action" })(req);
}

export const dynamic = "force-dynamic";
