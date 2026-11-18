import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { toJson, parseJson } from "@/server/lib/json";
import { resolveAudienceIds, parseRules, type SegmentRule } from "@/server/services/segments";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const segments = await db.segment.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: { createdAt: "desc" } });
    const withCounts = await Promise.all(
      segments.map(async (s) => ({
        ...s,
        rules: parseRules(s.rules),
        memberCount: await resolveAudienceIds(ctx.tenant.id, { segmentId: s.id }).then((ids) => ids.length),
      }))
    );
    return jsonOk({ segments: withCounts });
  }, { name: "segments-list" })(_req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; rules?: SegmentRule[] };
    if (!body.name?.trim()) return jsonError("bad_request", "Segment name is required", 400);
    if (!Array.isArray(body.rules) || body.rules.length === 0) return jsonError("bad_request", "At least one rule is required", 400);
    const segment = await db.segment.create({
      data: {
        tenantId: ctx.tenant.id,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        rules: toJson(body.rules),
      },
    });
    await audit(ctx, "segment.created", "segment", segment.id, { name: segment.name, rules: body.rules.length });
    return jsonOk({ segment: { ...segment, rules: parseRules(segment.rules) } });
  }, { name: "segments-create" })(req);
}

export async function DELETE(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const deleted = await db.segment.deleteMany({ where: { id, tenantId: ctx.tenant.id } });
    if (!deleted.count) return jsonError("not_found", "Segment not found", 404);
    await audit(ctx, "segment.deleted", "segment", id);
    return jsonOk({ ok: true });
  }, { name: "segments-delete" })(req);
}

export const dynamic = "force-dynamic";
