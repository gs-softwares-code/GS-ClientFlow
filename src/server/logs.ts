import { db } from "@/lib/db";
import { toJson } from "@/server/lib/json";

/**
 * Structured logging: emits one JSON line per event (stdout) and persists a
 * bounded tail into the SystemLog table so the Ops console can show real logs.
 */
export async function logEvent(
  level: "info" | "warn" | "error",
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
  tenantId?: string
): Promise<void> {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    tenantId: tenantId ?? null,
    ...(meta ? { meta } : {}),
  });
  if (level === "error") console.error(`[gscf] ${line}`);
  else console.log(`[gscf] ${line}`);

  try {
    await db.systemLog.create({
      data: { level, scope, message, meta: toJson(meta ?? {}), tenantId: tenantId ?? null },
    });
    // Bound the log table: opportunistic prune keeps only the newest 400 rows.
    if (Math.random() < 0.08) {
      const keep = await db.systemLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 400,
        select: { id: true },
      });
      if (keep.length === 400) {
        await db.systemLog.deleteMany({ where: { id: { notIn: keep.map((k) => k.id) } } });
      }
    }
  } catch {
    // Logging must never break the request path.
  }
}
