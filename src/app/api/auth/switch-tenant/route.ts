import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { switchTenant } from "@/server/tenancy/session";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";
import { logAuditEvent } from "@/server/tenancy/audit";

/**
 * Enterprise Tenant Switching Endpoint
 * Hardened against session fixation and privilege escalation.
 */

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    // Only platform administrators or multi-tenant authorized users may switch context
    if (!ctx.user.isPlatformAdmin) {
      await logAuditEvent(ctx, {
        action: "auth.switch_tenant_denied",
        entity: "tenant",
        metadata: { reason: "non_platform_admin_attempt" },
      }, request);
      return jsonError("forbidden", "Only platform admins can switch business tenants", 403);
    }

    const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
    const targetTenantId = (body.tenantId ?? "").trim();
    if (!targetTenantId) {
      return jsonError("bad_request", "Target tenantId is required", 400);
    }

    const target = await db.tenant.findFirst({
      where: { id: targetTenantId, status: "active" },
    });

    if (!target) {
      await logAuditEvent(ctx, {
        action: "auth.switch_tenant_target_invalid",
        entity: "tenant",
        entityId: targetTenantId,
      }, request);
      return jsonError("not_found", "Target business tenant not found or inactive", 404);
    }

    // Invalidate old session and rotate to a fresh session cookie
    const newSessionId = await switchTenant(ctx.sessionId, ctx.user.id, target.id);

    // Record immutable audit entry
    await logAuditEvent(ctx, {
      action: "auth.switch_tenant_success",
      entity: "tenant",
      entityId: target.id,
      changes: {
        before: { tenantId: ctx.tenant.id, slug: ctx.tenant.slug },
        after: { tenantId: target.id, slug: target.slug },
      },
      metadata: { newSessionId },
    }, request);

    return jsonOk({
      ok: true,
      tenant: {
        id: target.id,
        slug: target.slug,
        name: target.name,
      },
    });
  }, { name: "auth-switch", limitPerMinute: 20 })(req);
}

export const dynamic = "force-dynamic";
