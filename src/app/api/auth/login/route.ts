import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/server/tenancy/session";
import { withPublicRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withPublicRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) return jsonError("bad_request", "Email is required", 400);

    const user = await db.user.findFirst({ where: { tenantId: ctx.tenant.id, email } });
    if (!user) return jsonError("not_found", "No staff account with that email for this business", 404);

    await createSession(user.id, ctx.tenant.id);
    await audit(ctx, "auth.login", "user", user.id, { email });
    return jsonOk({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isPlatformAdmin: user.isPlatformAdmin },
      tenant: { id: ctx.tenant.id, slug: ctx.tenant.slug, name: ctx.tenant.name },
    });
  }, { name: "auth-login", limitPerMinute: 20 })(req);
}

export const dynamic = "force-dynamic";
