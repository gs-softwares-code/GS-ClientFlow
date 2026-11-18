import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { parseJson } from "@/server/lib/json";
import { withRoute, jsonOk } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    const where = workflowId
      ? { tenantId: ctx.tenant.id, workflowId }
      : { tenantId: ctx.tenant.id };
    const runs = await db.workflowRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(url.searchParams.get("limit") ?? 40), 120),
      include: {
        workflow: { select: { id: true, name: true, category: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    return jsonOk({
      runs: runs.map((r) => ({
        id: r.id,
        workflow: r.workflow,
        customer: r.customer,
        status: r.status,
        triggerInfo: parseJson<Record<string, unknown>>(r.triggerInfo, {}),
        steps: parseJson<{ step: string; detail: string; ok: boolean }[]>(r.steps, []),
        createdAt: r.createdAt,
      })),
    });
  }, { name: "workflow-runs" })(req);
}

export const dynamic = "force-dynamic";
