import { db } from "@/lib/db";
import { readSettings } from "@/server/settings";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { nextBirthday } from "@/server/services/customers";
import { executeWorkflowForCustomer } from "@/server/services/workflow-engine";
import { logEvent } from "@/server/logs";
import { workerStats } from "@/server/ops-state";

/**
 * Date-trigger scheduler — the "Cron" of the automation engine. One scan per
 * interval covers ALL tenants (single query per concern — no per-tenant cron
 * triggers) and emits/ executes only what is due, so no wasted external API
 * calls or DB chatter.
 *
 * Scans:
 *   - birthdays      -> customer.birthday.upcoming events (yearly dedupe)
 *   - inactive       -> dateKind=inactive workflows (monthly dedupe)
 *   - offer expiry   -> offers auto-flip to "expired" past expiresAt
 */

export type ScanSummary = {
  tenantsScanned: number;
  birthdayEvents: number;
  inactiveRuns: number;
  offersExpired: number;
};

export async function runDueScans(): Promise<ScanSummary> {
  const summary: ScanSummary = { tenantsScanned: 0, birthdayEvents: 0, inactiveRuns: 0, offersExpired: 0 };
  const stats = workerStats();

  try {
    // ---- auto-expire offers (cheap single query, all tenants)
    const expiredOffers = await db.offer.updateMany({
      where: { status: "active", expiresAt: { lt: new Date() } },
      data: { status: "expired" },
    });
    summary.offersExpired = expiredOffers.count;

    const tenants = await db.tenant.findMany({ where: { status: "active" } });
    summary.tenantsScanned = tenants.length;

    for (const tenant of tenants) {
      const settings = readSettings(tenant);
      const lead = settings.birthdayLeadDays;
      const inactiveDays = settings.inactiveDays;

      // ---- birthday scan (indexed on tenantId, birthdayMonth, birthdayDay)
      const now = new Date();
      const month = now.getUTCMonth() + 1;
      const upcoming = await db.customer.findMany({
        where: {
          tenantId: tenant.id,
          status: "active",
          birthdayMonth: { in: [month, month === 12 ? 1 : month + 1] },
        },
        select: { id: true, name: true, birthdayMonth: true, birthdayDay: true },
        take: 500,
      });

      for (const c of upcoming) {
        const nb = nextBirthday(c.birthdayMonth!, c.birthdayDay ?? null);
        if (!nb || nb.daysUntil < 0 || nb.daysUntil > lead) continue;
        const dedupeKey = `bday:${tenant.id}:${c.id}:${nb.date.getUTCFullYear()}`;
        await publish(db, {
          tenantId: tenant.id,
          type: EventTypes.CustomerBirthdayUpcoming,
          payload: {
            customerId: c.id,
            name: c.name,
            birthdayMonth: c.birthdayMonth,
            birthdayDay: c.birthdayDay,
            leadDays: nb.daysUntil,
            occurrenceYear: nb.date.getUTCFullYear(),
          },
          dedupeKey,
        });
        summary.birthdayEvents += 1;
      }

      // ---- inactive customer scan -> run dateKind=inactive workflows
      const inactiveWorkflows = await db.workflow.findMany({
        where: { tenantId: tenant.id, active: true, triggerType: "date", dateKind: "inactive" },
      });
      if (inactiveWorkflows.length) {
        const cutoff = new Date(Date.now() - inactiveDays * 86400_000);
        const inactiveCustomers = await db.customer.findMany({
          where: { tenantId: tenant.id, status: "active", OR: [{ lastVisitAt: { lt: cutoff } }, { lastVisitAt: null, createdAt: { lt: new Date(Date.now() - 60 * 86400_000) } }] },
          select: { id: true },
          take: 400,
        });
        const monthKey = new Date().toISOString().slice(0, 7); // yyyy-mm monthly dedupe
        for (const wf of inactiveWorkflows) {
          for (const customer of inactiveCustomers) {
            summary.inactiveRuns += 1;
            await executeWorkflowForCustomer(wf, customer.id, {
              seed: `inactive:${monthKey}`,
              source: `inactive scan (${inactiveDays}+ days)`,
            });
          }
        }
      }
    }
  } catch (err) {
    stats.lastError = err instanceof Error ? err.message : String(err);
    await logEvent("error", "scheduler", `Scan failed: ${stats.lastError}`);
  }
  return summary;
}
