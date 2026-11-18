import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { workerStats, rateLimitStats } from "@/server/ops-state";
import { usageSnapshot } from "@/server/usage";
import { tick } from "@/server/events/worker";
import { runDueScans } from "@/server/events/scheduler";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";
import { parseJson } from "@/server/lib/json";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const [queueCounts, globalCounts, scheduled, logs, retention, tableRows] = await Promise.all([
      db.outboxEvent.groupBy({ by: ["status"], where: { tenantId: ctx.tenant.id }, _count: true }),
      db.outboxEvent.groupBy({ by: ["status"], _count: true }),
      db.scheduledAction.groupBy({ by: ["status"], _count: true }),
      db.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      db.scheduledAction.findMany({ where: { status: "pending" }, orderBy: { dueAt: "asc" }, take: 8 }),
      Promise.all(
        (["customer", "visit", "feedback", "appointment", "message", "rewardTransaction", "outboxEvent"] as const).map(async (t) => ({
          table: t,
          rows: await (db as unknown as Record<string, { count: (a: { where?: unknown }) => Promise<number> }>)[t].count({ where: { tenantId: ctx.tenant.id } }),
        }))
      ),
    ]);

    const dueNow = await db.scheduledAction.count({ where: { status: "pending", dueAt: { lte: new Date() } } });
    const nextDue = retention[0]?.dueAt ?? null;
    const usage = await usageSnapshot(ctx.tenant.id, ctx.tenant.plan).catch(() => null);

    return jsonOk({
      worker: workerStats(),
      queue: {
        tenant: queueCounts.map((c) => ({ status: c.status, count: c._count })),
        global: globalCounts.map((c) => ({ status: c.status, count: c._count })),
        deadLetterGlobal: globalCounts.find((c) => c.status === "dead")?._count ?? 0,
      },
      scheduled: {
        counts: scheduled.map((c) => ({ status: c.status, count: c._count })),
        dueNow,
        nextDue,
        upcoming: retention.map((a) => ({ id: a.id, kind: a.kind, dueAt: a.dueAt, payload: parseJson<Record<string, string>>(a.payload, {}) })),
      },
      rateLimits: rateLimitStats(),
      usage,
      storage: tableRows,
      logs: logs.map((l) => ({
        id: l.id, level: l.level, scope: l.scope, message: l.message,
        meta: parseJson<Record<string, unknown>>(l.meta, {}), tenantId: l.tenantId, createdAt: l.createdAt,
      })),
    });
  }, { name: "ops-overview" })(_req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (_ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === "tick") {
      const result = await tick();
      return jsonOk({ message: `Worker tick: ${result.processed} processed, ${result.failed} failed, ${result.dead} dead-lettered, ${result.scheduledProcessed} scheduled actions`, result });
    }
    if (body.action === "scan") {
      const result = await runDueScans();
      return jsonOk({ message: `Scheduler scan: ${result.tenantsScanned} tenants, ${result.birthdayEvents} birthday events, ${result.inactiveRuns} inactive runs, ${result.offersExpired} offers expired`, result });
    }
    return jsonError("bad_request", "Unknown action (tick | scan)", 400);
  }, { name: "ops-action", limitPerMinute: 30 })(req);
}

export const dynamic = "force-dynamic";
