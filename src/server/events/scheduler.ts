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
  membershipsReminded: number;
  gymSummariesDispatched: number;
  appointments24hReminded: number;
};

export async function runDueScans(): Promise<ScanSummary> {
  const summary: ScanSummary = {
    tenantsScanned: 0,
    birthdayEvents: 0,
    inactiveRuns: 0,
    offersExpired: 0,
    membershipsReminded: 0,
    gymSummariesDispatched: 0,
    appointments24hReminded: 0,
  };
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

      // ---- Vertical 2: Gym Membership Expiry Scan (7d, 3d, 1d intervals)
      const nowMs = Date.now();
      const in8Days = new Date(nowMs + 8 * 86400_000);
      const activeMemberships = await db.membership.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: ["ACTIVE", "EXPIRING_SOON"] },
          expiryDate: { lte: in8Days },
        },
      });

      for (const m of activeMemberships) {
        const msRemaining = m.expiryDate.getTime() - nowMs;
        const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400_000));

        if (msRemaining <= 0) {
          await db.membership.update({ where: { id: m.id }, data: { status: "EXPIRED" } });
          continue;
        }

        if (daysRemaining <= 7 && daysRemaining > 0) {
          const reminderSlot = daysRemaining <= 1 ? 1 : daysRemaining <= 3 ? 3 : 7;
          const dedupeKey = `membrem:${m.id}:${reminderSlot}d`;

          await publish(db, {
            tenantId: tenant.id,
            type: EventTypes.MembershipExpiringSoon,
            payload: {
              membershipId: m.id,
              customerId: m.customerId,
              daysRemaining,
              renewalLink: `https://${tenant.slug}.gsclientflow.app/portal?renew=${m.id}`,
            },
            dedupeKey,
          });
          summary.membershipsReminded += 1;
        }
      }

      // ---- Vertical 2: Gym Owner Daily Operations Digest
      if (tenant.businessCategory === "gym" || (tenant as { verticalType?: string }).verticalType === "GYM") {
        const todayDate = new Date().toISOString().slice(0, 10);
        const dedupeKey = `gymsummary:${tenant.id}:${todayDate}`;

        const [activeCount, expiredCount, pendingRows, in7dCount] = await Promise.all([
          db.membership.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
          db.membership.count({ where: { tenantId: tenant.id, status: "EXPIRED" } }),
          db.membership.findMany({
            where: { tenantId: tenant.id, paymentStatus: { in: ["PENDING", "OVERDUE"] } },
            select: { priceAmount: true },
          }),
          db.membership.count({
            where: {
              tenantId: tenant.id,
              status: { in: ["ACTIVE", "EXPIRING_SOON"] },
              expiryDate: { lte: in8Days, gte: new Date() },
            },
          }),
        ]);

        const pendingDues = pendingRows.reduce((acc, r) => acc + r.priceAmount, 0);

        await publish(db, {
          tenantId: tenant.id,
          type: EventTypes.OpsDailyGymSummary,
          payload: {
            date: todayDate,
            activeCount,
            expiredCount,
            pendingDuesAmount: pendingDues,
            expiringIn7DaysCount: in7dCount,
          },
          dedupeKey,
        });
        summary.gymSummariesDispatched += 1;
      }

      // ---- Vertical 3: Smart Salon 24h Reminder Sweep
      const in25Hours = new Date(nowMs + 25 * 3600_000);
      const in23Hours = new Date(nowMs + 23 * 3600_000);

      const dueAppointments = await db.appointment.findMany({
        where: {
          tenantId: tenant.id,
          status: "scheduled",
          reminder24hSentAt: null,
          startAt: { gte: in23Hours, lte: in25Hours },
        },
      });

      for (const appt of dueAppointments) {
        await publish(db, {
          tenantId: tenant.id,
          type: EventTypes.AppointmentReminder24h,
          payload: {
            appointmentId: appt.id,
            customerId: appt.customerId,
            rescheduleUrl: `https://${tenant.slug}.gsclientflow.app/portal?reschedule=${appt.id}`,
          },
          dedupeKey: `apt_rem24h:${appt.id}`,
        });

        await db.appointment.update({
          where: { id: appt.id },
          data: { reminder24hSentAt: new Date() },
        });

        summary.appointments24hReminded += 1;
      }
    }
  } catch (err) {
    stats.lastError = err instanceof Error ? err.message : String(err);
    await logEvent("error", "scheduler", `Scan failed: ${stats.lastError}`);
  }
  return summary;
}
