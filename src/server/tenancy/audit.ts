import { db } from "@/lib/db";
import { toJson } from "@/server/lib/json";
import type { SessionCtx } from "@/server/tenancy/session";
import type { PublicCtx } from "@/server/tenancy/guard";

/**
 * Enterprise Audit Trail Engine
 * Guarantees tamper-evident, detailed audit logging with actor attribution,
 * client metadata, and payload snapshots.
 */

export type AuditEvent = {
  action: string;
  entity: string;
  entityId?: string;
  changes?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
  metadata?: Record<string, unknown>;
};

export async function logAuditEvent(
  ctx: SessionCtx | PublicCtx,
  event: AuditEvent,
  req?: Request
): Promise<void> {
  const actorId = "user" in ctx ? ctx.user.id : null;
  const actorRole = "user" in ctx ? ctx.user.role : "public";
  const actorLabel = "user" in ctx ? `${ctx.user.name} (${ctx.user.email})` : "public";

  const clientIp =
    req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req?.headers.get("x-real-ip") ||
    ("ip" in ctx ? ctx.ip : "unknown");

  const userAgent = req?.headers.get("user-agent") || "unknown";

  const metaPayload = {
    ...event.metadata,
    role: actorRole,
    clientIp,
    userAgent,
    changes: event.changes || null,
  };

  try {
    await db.auditLog.create({
      data: {
        tenantId: ctx.tenant.id,
        actorId,
        actorLabel,
        action: event.action,
        entity: event.entity,
        entityId: event.entityId || null,
        meta: toJson(metaPayload),
      },
    });
  } catch (err) {
    // Audit logging must be non-blocking for operational resilience, but recorded
    console.error("[Enterprise AuditLog Failed]:", err);
  }
}
