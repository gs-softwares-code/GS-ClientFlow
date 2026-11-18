import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { toJson, parseJson } from "@/server/lib/json";
import { runWorkflowForAudience, workflowPresetDefinitions } from "@/server/services/workflow-engine";
import { parseRules, type SegmentRule } from "@/server/services/segments";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    if (url.searchParams.get("presets") !== null) {
      return jsonOk({ presets: await workflowPresetDefinitions() });
    }
    const workflows = await db.workflow.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { createdAt: "asc" },
    });
    const segments = await db.segment.findMany({ where: { tenantId: ctx.tenant.id }, select: { id: true, name: true } });
    return jsonOk({
      workflows: workflows.map((w) => ({ ...w, conditionRules: parseRules(w.conditionRules) })),
      segments,
    });
  }, { name: "workflows-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string; category?: string; triggerType?: string; triggerEvent?: string;
      dateKind?: string; offsetMinutes?: number; conditionRules?: SegmentRule[];
      segmentId?: string | null; channel?: string; template?: string; requireConsent?: boolean;
    };
    if (!body.name?.trim() || !body.template?.trim()) return jsonError("bad_request", "Name and template are required", 400);
    const workflow = await db.workflow.create({
      data: {
        tenantId: ctx.tenant.id,
        name: body.name.trim(),
        category: body.category ?? "custom",
        triggerType: body.triggerType ?? "event",
        triggerEvent: body.triggerEvent ?? null,
        dateKind: body.dateKind ?? null,
        offsetMinutes: body.offsetMinutes ?? null,
        conditionRules: toJson(body.conditionRules ?? []),
        segmentId: body.segmentId ?? null,
        channel: body.channel ?? "email",
        template: body.template.trim(),
        requireConsent: body.requireConsent ?? true,
        active: true,
      },
    });
    await audit(ctx, "workflow.created", "workflow", workflow.id, { name: workflow.name });
    return jsonOk({ workflow: { ...workflow, conditionRules: parseRules(workflow.conditionRules) } });
  }, { name: "workflows-create" })(req);
}

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      workflowId?: string; active?: boolean; name?: string; template?: string; channel?: string;
      offsetMinutes?: number; requireConsent?: boolean; conditionRules?: SegmentRule[]; segmentId?: string | null; run?: boolean; customerId?: string;
    };
    if (!body.workflowId) return jsonError("bad_request", "workflowId is required", 400);
    const workflow = await db.workflow.findFirst({ where: { id: body.workflowId, tenantId: ctx.tenant.id } });
    if (!workflow) return jsonError("not_found", "Workflow not found", 404);

    if (body.run) {
      const result = await runWorkflowForAudience(workflow.id, body.customerId ?? null);
      await audit(ctx, "workflow.manual_run", "workflow", workflow.id, { result });
      return jsonOk({ run: result });
    }

    const updated = await db.workflow.update({
      where: { id: workflow.id },
      data: {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.template !== undefined ? { template: body.template } : {}),
        ...(body.channel !== undefined ? { channel: body.channel } : {}),
        ...(body.offsetMinutes !== undefined ? { offsetMinutes: body.offsetMinutes } : {}),
        ...(body.requireConsent !== undefined ? { requireConsent: body.requireConsent } : {}),
        ...(body.conditionRules !== undefined ? { conditionRules: toJson(body.conditionRules) } : {}),
        ...(body.segmentId !== undefined ? { segmentId: body.segmentId } : {}),
      },
    });
    await audit(ctx, "workflow.updated", "workflow", workflow.id, { fields: Object.keys(body) });
    return jsonOk({ workflow: { ...updated, conditionRules: parseRules(updated.conditionRules) } });
  }, { name: "workflows-update" })(req);
}

export const dynamic = "force-dynamic";
