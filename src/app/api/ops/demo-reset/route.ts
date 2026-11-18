import { NextRequest } from "next/server";
import { reseed } from "@/server/seed";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";
import { logAuditEvent } from "@/server/tenancy/audit";

/**
 * Administrative Database Reseed Endpoint
 * Strictly prohibited in production environments; restricted to platform admins / owners.
 */

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    // 1. Production safety lock
    if (process.env.NODE_ENV === "production") {
      await logAuditEvent(ctx, {
        action: "ops.demo_reset_blocked",
        entity: "system",
        metadata: { reason: "production_environment_lock" },
      }, request);
      return jsonError("forbidden", "Database demo reset is strictly disabled in production environments", 403);
    }

    // 2. Strict RBAC verification
    if (!ctx.user.isPlatformAdmin && ctx.user.role !== "owner") {
      await logAuditEvent(ctx, {
        action: "ops.demo_reset_denied",
        entity: "system",
        metadata: { role: ctx.user.role },
      }, request);
      return jsonError("forbidden", "Requires platform administrator or owner privilege", 403);
    }

    const result = await reseed();
    await logAuditEvent(ctx, {
      action: "ops.demo_reset_executed",
      entity: "system",
      metadata: result,
    }, request);

    return jsonOk({
      message: `Demo dataset regenerated (${result.tenants} tenants, ${result.customers} customers). Sessions cleared — please sign in again.`,
      ...result,
    });
  }, { name: "ops-demo-reset", limitPerMinute: 3 })(req);
}

export const dynamic = "force-dynamic";
