import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const [services, staff] = await Promise.all([
      db.service.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: { name: "asc" } }),
      db.staff.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: { name: "asc" } }),
    ]);
    return jsonOk({ services, staff });
  }, { name: "services-list" })(_req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string; name?: string; durationMin?: number; priceRupees?: number; role?: string; active?: boolean;
    };
    if (!body.name?.trim()) return jsonError("bad_request", "Name is required", 400);
    if (body.kind === "staff") {
      const staff = await db.staff.create({
        data: { tenantId: ctx.tenant.id, name: body.name.trim(), role: body.role ?? "staff", active: body.active ?? true },
      });
      await audit(ctx, "staff.created", "staff", staff.id, { name: staff.name });
      return jsonOk({ staff });
    }
    const service = await db.service.create({
      data: {
        tenantId: ctx.tenant.id,
        name: body.name.trim(),
        durationMin: body.durationMin ?? 30,
        priceCents: Math.round((body.priceRupees ?? 0) * 100),
      },
    });
    await audit(ctx, "service.created", "service", service.id, { name: service.name });
    return jsonOk({ service });
  }, { name: "services-create" })(req);
}

export const dynamic = "force-dynamic";
