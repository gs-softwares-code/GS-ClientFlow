import { NextRequest, NextResponse } from "next/server";
import { backupSnapshot } from "@/server/services/whitelabel";
import { withRoute, jsonError } from "@/server/tenancy/guard";
import { logAuditEvent } from "@/server/tenancy/audit";
import { requirePermission, Permissions } from "@/server/tenancy/rbac";

/**
 * Enterprise Backup Export Endpoint
 * Full, restorable JSON snapshot of the tenant's data.
 * Guarded by RBAC permissions (owner / admin / auditor).
 */
export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    // RBAC: Verify trigger backup permission
    if (!ctx.user.isPlatformAdmin && ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      await logAuditEvent(ctx, {
        action: "ops.backup_denied",
        entity: "tenant",
        metadata: { role: ctx.user.role },
      }, request);
      return jsonError("forbidden", "Insufficient permissions to generate system backup", 403);
    }

    const snapshot = await backupSnapshot(ctx.tenant.id);
    await logAuditEvent(ctx, {
      action: "ops.backup_exported",
      entity: "tenant",
      entityId: ctx.tenant.id,
      metadata: { counts: snapshot.counts },
    }, request);

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="gscf-backup-${ctx.tenant.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }, { name: "ops-backup", limitPerMinute: 5 })(req);
}

export const dynamic = "force-dynamic";
