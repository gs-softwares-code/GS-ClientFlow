import { NextRequest, NextResponse } from "next/server";
import { backupSnapshot } from "@/server/services/whitelabel";
import { withRoute, audit } from "@/server/tenancy/guard";

/** Backup export — a full, restorable JSON snapshot of the tenant's data. */
export async function GET(req: NextRequest) {
  return withRoute(async (ctx) => {
    const snapshot = await backupSnapshot(ctx.tenant.id);
    await audit(ctx, "ops.backup_exported", "tenant", ctx.tenant.id, { counts: snapshot.counts });
    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="gscf-backup-${ctx.tenant.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }, { name: "ops-backup", limitPerMinute: 5 })(req);
}

export const dynamic = "force-dynamic";
