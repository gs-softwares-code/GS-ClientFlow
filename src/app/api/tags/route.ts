import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const tags = await db.tag.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: { name: "asc" } });
    return jsonOk({ tags });
  }, { name: "tags-list" })(_req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; color?: string };
    if (!body.name?.trim()) return jsonError("bad_request", "Tag name is required", 400);
    const existing = await db.tag.findFirst({ where: { tenantId: ctx.tenant.id, name: body.name.trim() } });
    if (existing) return jsonError("duplicate", "Tag already exists", 409);
    const tag = await db.tag.create({
      data: { tenantId: ctx.tenant.id, name: body.name.trim(), color: body.color ?? "#0f766e" },
    });
    await audit(ctx, "tag.created", "tag", tag.id, { name: tag.name });
    return jsonOk({ tag });
  }, { name: "tags-create" })(req);
}

export const dynamic = "force-dynamic";
