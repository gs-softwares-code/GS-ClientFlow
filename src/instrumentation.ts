/**
 * Server bootstrap — starts the background automation on boot:
 *   1. seeds the demo dataset once (if the DB is empty)
 *   2. runs the outbox worker every few seconds (claim -> idempotent
 *      handlers -> retry/backoff -> dead-letter)
 *   3. runs the date-trigger scheduler every 45s (birthdays, inactive
 *      customers, offer expiry) — a single scan for ALL tenants, no
 *      per-tenant cron triggers and no wasted external API calls
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __gscfBooted?: boolean };
  if (g.__gscfBooted) return;
  g.__gscfBooted = true;

  const { db } = await import("@/lib/db");
  const { reseed } = await import("@/server/seed");
  const { tick } = await import("@/server/events/worker");
  const { runDueScans } = await import("@/server/events/scheduler");
  const { workerStats } = await import("@/server/ops-state");
  const { logEvent } = await import("@/server/logs");

  try {
    const tenants = await db.tenant.count();
    if (tenants === 0) {
      console.log("[gscf] boot: seeding demo dataset...");
      await reseed();
      console.log("[gscf] boot: demo dataset ready");
    }
  } catch (err) {
    console.error("[gscf] boot: seed failed", err);
  }

  const stats = workerStats();
  stats.startedAt = Date.now();

  const workerTimer = setInterval(() => {
    void tick().catch((err) => {
      console.error("[gscf] worker tick error:", err);
    });
  }, 4000);

  const schedulerTimer = setInterval(() => {
    void runDueScans().catch((err) => {
      console.error("[gscf] scheduler error:", err);
    });
  }, 45000);

  // Warm-up tick + scan so birthday events and engineered demos appear quickly.
  void tick().catch(() => undefined);
  void runDueScans().catch(() => undefined);

  void logEvent("info", "boot", "GS ClientFlow automation worker started (4s tick, 45s scans)");

  // Never let the timers keep the process alive artificially.
  workerTimer.unref?.();
  schedulerTimer.unref?.();
}
