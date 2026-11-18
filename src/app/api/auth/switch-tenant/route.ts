import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { switchTenant } from "@/server/tenancy/session";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    if (!ctx.user.isPlatformAdmin) {
      return jsonError("forbidden", "Only the platform demo admin can switch tenants", 403);
    }
    const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
    const target = await db.tenant.findFirst({ where: { id: body.tenantId ?? "", status: "active" } });
    if (!target) return jsonError("not_found", "Tenant not found", 404);
    await switchTenant(ctx.user.id, target.id);
    await audit(ctx, "auth.switch_tenant", "tenant", target.id, { to: target.slug });
    return jsonOk({ ok: true, tenant: { id: target.id, slug: target.slug, name: target.name } });
  }, { name: "auth-switch", limitPerMinute: 20 })(req);
}

export const dynamic = "force-dynamic";
