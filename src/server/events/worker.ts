import { db, withTenantContext } from "@/lib/db";
import { handlers } from "@/server/events/handlers";
import { workerStats } from "@/server/ops-state";
import { logEvent } from "@/server/logs";
import { executeCampaign } from "@/server/services/campaigns";
import { executeWorkflowForCustomer } from "@/server/services/workflow-engine";
import { sendChannelMessage } from "@/server/channels/adapter";
import { parseJson } from "@/server/lib/json";
import { verifyEventPayload, publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";

/**
 * Outbox worker — the sandbox equivalent of the Cloudflare Queues consumer.
 *
 * Tick semantics:
 *   1. claim due events (pending, availableAt <= now) with a lease so a
 *      crashed mid-flight attempt returns to the queue automatically
 *   2. idempotent consumption: if an identical event (same dedupe key) has
 *      already completed, the duplicate is marked done without side effects
 *   3. handler failure -> exponential backoff (3s * 2^attempts, capped 5min)
 *   4. attempts >= maxAttempts -> DEAD (dead-letter queue, retryable from UI)
 *   5. due ScheduledActions (delayed workflow steps, reminders, campaign runs)
 *      are processed the same way with their own retry budget
 */

const CLAIM_LIMIT = 12;
const LEASE_MS = 30_000;
const BACKOFF_CAP_MS = 5 * 60_000;

export type TickSummary = {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
  retried: number;
  scheduledProcessed: number;
};

export async function tick(): Promise<TickSummary> {
  const stats = workerStats();
  const summary: TickSummary = { claimed: 0, processed: 0, failed: 0, dead: 0, retried: 0, scheduledProcessed: 0 };
  stats.running = true;
  stats.ticks += 1;
  stats.lastTickAt = Date.now();

  try {
    // -------- 1. claim outbox events
    const now = new Date();
    const due = await db.outboxEvent.findMany({
      where: { status: "pending", availableAt: { lte: now } },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
      take: CLAIM_LIMIT,
    });
    summary.claimed = due.length;

    if (due.length) {
      const ids = due.map((e) => e.id);
      await db.outboxEvent.updateMany({
        where: { id: { in: ids }, status: "pending" },
        data: { status: "processing", attempts: { increment: 1 }, availableAt: new Date(Date.now() + LEASE_MS) },
      });
    }

    for (const event of due) {
      try {
        // Cryptographic HMAC integrity verification
        let parsedPayload: Record<string, unknown> | null = null;
        try {
          parsedPayload = JSON.parse(event.payload);
        } catch {
          // Non-JSON or legacy payload
        }

        if (parsedPayload && typeof parsedPayload._meta === "object" && parsedPayload._meta !== null) {
          const meta = parsedPayload._meta as { correlationId?: string; signature?: string };
          if (meta.signature && meta.correlationId) {
            const { _meta, ...bizData } = parsedPayload;
            const rawBizStr = JSON.stringify(bizData);
            const isValid = verifyEventPayload(
              event.tenantId,
              event.type,
              rawBizStr,
              meta.correlationId,
              meta.signature
            );
            if (!isValid) {
              await db.outboxEvent.update({
                where: { id: event.id },
                data: {
                  status: "dead",
                  processedAt: new Date(),
                  lastError: "Security Violation: Cryptographic signature mismatch (tampered event)",
                },
              });
              summary.dead += 1;
              stats.dead += 1;
              await logEvent(
                "error",
                "worker",
                `HMAC signature failure for outbox event ${event.id} (tenant ${event.tenantId})`,
                { eventId: event.id, tenantId: event.tenantId },
                event.tenantId
              );
              continue;
            }
          }
        }

        // idempotent consumption via dedupe key
        if (event.dedupeKey) {
          const twin = await db.outboxEvent.findFirst({
            where: { dedupeKey: event.dedupeKey, status: "done" },
          });
          if (twin) {
            await db.outboxEvent.update({
              where: { id: event.id },
              data: { status: "done", processedAt: new Date(), lastError: "duplicate (already processed)" },
            });
            summary.processed += 1;
            continue;
          }
        }

        const handler = handlers[event.type];
        if (!handler) {
          await db.outboxEvent.update({
            where: { id: event.id },
            data: { status: "dead", processedAt: new Date(), lastError: `No handler for ${event.type}` },
          });
          summary.dead += 1;
          continue;
        }

        await withTenantContext(event.tenantId, async () => {
          await handler(event);
        });

        await db.outboxEvent.update({ where: { id: event.id }, data: { status: "done", processedAt: new Date(), lastError: null } });
        summary.processed += 1;
        stats.processed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stats.failed += 1;
        summary.failed += 1;
        if (event.attempts >= event.maxAttempts) {
          // dead-letter
          await db.outboxEvent.update({
            where: { id: event.id },
            data: { status: "dead", processedAt: new Date(), lastError: message },
          });
          summary.dead += 1;
          stats.dead += 1;
          await logEvent("error", "worker", `Event ${event.type} dead-lettered: ${message}`, { eventId: event.id }, event.tenantId);
        } else {
          const backoff = Math.min(3000 * 2 ** event.attempts, BACKOFF_CAP_MS);
          await db.outboxEvent.update({
            where: { id: event.id },
            data: { status: "pending", availableAt: new Date(Date.now() + backoff), lastError: message },
          });
          summary.retried += 1;
          stats.retried += 1;
        }
      }
    }

    // -------- 2. scheduled actions
    const actions = await db.scheduledAction.findMany({
      where: { status: "pending", dueAt: { lte: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 15,
    });
    for (const action of actions) {
      try {
        await db.scheduledAction.update({
          where: { id: action.id },
          data: { attempts: { increment: 1 } },
        });
        await withTenantContext(action.tenantId, async () => {
          await processScheduledAction(action.id, action.tenantId, action.kind, parseJson<Record<string, string>>(action.payload, {}));
        });
        await db.scheduledAction.update({ where: { id: action.id }, data: { status: "done", processedAt: new Date() } });
        summary.scheduledProcessed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = action.attempts + 1;
        if (attempts >= 5) {
          await db.scheduledAction.update({ where: { id: action.id }, data: { status: "failed", processedAt: new Date() } });
          await logEvent("error", "worker", `Scheduled action ${action.kind} failed permanently: ${message}`, { actionId: action.id }, action.tenantId);
        } else {
          await db.scheduledAction.update({
            where: { id: action.id },
            data: { status: "pending", dueAt: new Date(Date.now() + Math.min(3000 * 2 ** attempts, BACKOFF_CAP_MS)) },
          });
        }
      }
    }
  } catch (err) {
    stats.lastError = err instanceof Error ? err.message : String(err);
    await logEvent("error", "worker", `Tick crashed: ${stats.lastError}`);
  } finally {
    stats.running = false;
  }
  return summary;
}

async function processScheduledAction(actionId: string, tenantId: string, kind: string, payload: Record<string, string>) {
  switch (kind) {
    case "campaign_run": {
      if (!payload.campaignId) throw new Error("campaign_run missing campaignId");
      await executeCampaign(tenantId, payload.campaignId);
      break;
    }
    case "workflow_step": {
      const workflow = await db.workflow.findUnique({ where: { id: payload.workflowId } });
      if (!workflow) return;
      await executeWorkflowForCustomer(workflow, payload.customerId, {
        seed: payload.seed ?? `step:${actionId}`,
        source: "delayed workflow step",
      });
      break;
    }
    case "appointment_reminder": {
      const appt = await db.appointment.findUnique({ where: { id: payload.appointmentId } });
      if (!appt || appt.status !== "scheduled" && appt.status !== "confirmed") return;
      const tenant = await db.tenant.findUnique({ where: { id: appt.tenantId } });
      const customer = await db.customer.findFirst({
        where: { id: appt.customerId, tenantId: appt.tenantId },
        select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true },
      });
      if (!tenant || !customer) return;
      const { readSettings } = await import("@/server/settings");
      const settings = readSettings(tenant);
      const channel = settings.channels.sms.enabled ? "sms" : "email";
      await sendChannelMessage({
        tenant,
        customer,
        channel,
        kind: "transactional",
        subject: `Reminder: appointment at ${tenant.name}`,
        body: `Hi ${customer.name.split(" ")[0]}, reminding you of your appointment at ${tenant.name} on ${appt.startAt.toLocaleString("en-IN")}. See you soon!`,
        idempotencyKey: `aptrem:${appt.id}`,
      });
      await db.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
      break;
    }
    case "post_appointment_followup": {
      const appt = await db.appointment.findUnique({ where: { id: payload.appointmentId } });
      if (!appt || appt.status !== "completed") return;
      const tenant = await db.tenant.findUnique({ where: { id: appt.tenantId } });
      const customer = await db.customer.findFirst({
        where: { id: appt.customerId, tenantId: appt.tenantId },
        select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true },
      });
      if (!tenant || !customer) return;
      await sendChannelMessage({
        tenant,
        customer,
        channel: "email",
        kind: "transactional",
        subject: `How was your visit to ${tenant.name}?`,
        body: `Hi ${customer.name.split(" ")[0]}, thank you for visiting ${tenant.name}. We would love your feedback — it takes 30 seconds and earns you loyalty points!`,
        idempotencyKey: `aptpfu:${appt.id}`,
      });
      await db.appointment.update({ where: { id: appt.id }, data: { followUpAt: new Date() } });
      break;
    }
    case "offer_expiry_reminder": {
      const offer = await db.offer.findFirst({ where: { id: payload.offerId, tenantId } });
      if (!offer || offer.status !== "active") return;
      const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) return;
      const channel = (offer.channel as "email" | "sms" | "whatsapp") ?? "email";
      const coupons = await db.coupon.findMany({
        where: { tenantId, offerId: offer.id, status: "active", customerId: { not: null } },
        include: { customer: { select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true } } },
        take: 50,
      });
      // Holders of active coupons for this offer get the expiry nudge;
      // offers issued to everyone fan out to the active audience instead.
      let recipients: { id: string; name: string; email: string; phone: string | null; consents: string; pointsBalance: number }[] = coupons
        .map((c) => c.customer!)
        .filter(Boolean);
      if (recipients.length === 0) {
        recipients = await db.customer.findMany({
          where: { tenantId, status: "active" },
          select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true },
          take: 50,
        });
      }
      for (const customer of recipients) {
        await sendChannelMessage({
          tenant,
          customer,
          channel,
          kind: "workflow",
          subject: `${offer.title} — ending soon`,
          body: `Hi ${customer.name.split(" ")[0]}, your offer "${offer.title}" at ${tenant.name} is about to expire — do not let it slip away!`,
          idempotencyKey: `offerexp:${offer.id}:${customer.id}`,
        }).catch(() => undefined);
      }
      await logEvent("info", "worker", `Offer expiry reminder processed for ${offer.title}`, { offerId: offer.id }, tenantId);
      break;
    }
    case "inactive_reengagement": {
      const workflow = await db.workflow.findUnique({ where: { id: payload.workflowId } });
      if (!workflow) return;
      await executeWorkflowForCustomer(workflow, payload.customerId, {
        seed: payload.seed ?? `inactive:${actionId}`,
        source: "inactive re-engagement scan",
      });
      break;
    }
    case "attendance_no_reply_check": {
      const att = await db.attendanceLog.findFirst({
        where: { id: payload.attendanceId, tenantId },
      });
      if (att && att.status === "ABSENT" && att.guardianReplyStatus === "PENDING") {
        await publish(db, {
          tenantId,
          type: EventTypes.AttendanceNoReplyTimeout,
          payload: {
            attendanceId: att.id,
            customerId: att.customerId,
            guardianPhone: att.guardianPhone,
          },
          dedupeKey: `att_timeout:${att.id}`,
        });
      }
      break;
    }
    default:
      throw new Error(`Unknown scheduled action kind: ${kind}`);
  }
}
