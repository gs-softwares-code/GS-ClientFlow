import type { OutboxEvent } from "@prisma/client";
import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes, PayloadSchemas } from "@/server/events/contracts";
import { dispatchEventWorkflows } from "@/server/services/workflow-engine";
import { applyFeedbackEarnings, applyReferralRewards, creditPoints, ensureReferralCode } from "@/server/services/loyalty";
import { readSettings } from "@/server/settings";
import { meterUsage } from "@/server/usage";
import { logEvent } from "@/server/logs";
import { sendChannelMessage } from "@/server/channels/adapter";

/**
 * Idempotent event handlers — the "queue consumers". Each handler may safely
 * run more than once for the same event: side effects are guarded by unique
 * idempotency keys (reward transactions, messages, scheduled actions).
 */

export type Handler = (event: OutboxEvent) => Promise<void>;

async function tenantOf(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant ${tenantId} vanished`);
  return tenant;
}

async function customerOf(tenantId: string, customerId: string) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true, status: true },
  });
  if (!customer) throw new Error(`Customer ${customerId} not in tenant`);
  return customer;
}

export const handlers: Record<string, Handler> = {
  // ------------------------------------------------ customers
  [EventTypes.CustomerRegistered]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.CustomerRegistered]);
    const tenant = await tenantOf(event.tenantId);
    const settings = readSettings(tenant);
    await meterUsage(event.tenantId, "registrations");

    // Every customer gets a personal referral code.
    await ensureReferralCode(event.tenantId, p.customerId, p.name);

    // Referral attribution: reward both sides, exactly once.
    if (typeof p.referredByCode === "string" && p.referredByCode) {
      const ref = await db.referralCode.findFirst({ where: { tenantId: event.tenantId, code: p.referredByCode.toUpperCase() } });
      if (ref && ref.customerId !== p.customerId) {
        await applyReferralRewards(event.tenantId, ref.customerId, p.customerId, settings);
        await db.referralCode.update({ where: { id: ref.id }, data: { usesCount: { increment: 1 } } });
        await logEvent("info", "loyalty", `Referral credit for code ${ref.code}`, { customerId: p.customerId }, event.tenantId);
      }
    }

    // Onboarding workflows (event-based triggers with delays).
    await dispatchEventWorkflows(event.tenantId, EventTypes.CustomerRegistered, { id: p.customerId }, {
      seed: `registered:${p.customerId}`,
      source: "customer registration",
    });
  },

  [EventTypes.CustomerUpdated]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.CustomerUpdated]);
    await dispatchEventWorkflows(event.tenantId, EventTypes.CustomerUpdated, { id: p.customerId }, {
      seed: `upd:${event.id}`,
      source: `customer updated (${p.reason})`,
    });
  },

  [EventTypes.CustomerBirthdayUpcoming]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.CustomerBirthdayUpcoming]);
    const year = new Date().getUTCFullYear();
    const seed = `bday:${p.birthdayMonth}-${p.birthdayDay}:${year}`;
    await dispatchEventWorkflows(event.tenantId, EventTypes.CustomerBirthdayUpcoming, { id: p.customerId }, {
      seed,
      source: `birthday in ${p.leadDays} day(s)`,
    });
    // Date-triggered birthday workflows (category preset) fire from the same event.
    const dateWfs = await db.workflow.findMany({
      where: { tenantId: event.tenantId, active: true, triggerType: "date", dateKind: "birthday" },
    });
    const { executeWorkflowForCustomer } = await import("@/server/services/workflow-engine");
    for (const wf of dateWfs) {
      await executeWorkflowForCustomer(wf, p.customerId, { seed, source: "birthday date trigger" });
    }
    await logEvent("info", "scheduler", `Birthday upcoming: customer ${p.customerId} (${p.leadDays}d)`, {}, event.tenantId);
  },

  // ------------------------------------------------ feedback
  [EventTypes.FeedbackSubmitted]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.FeedbackSubmitted]);
    const tenant = await tenantOf(event.tenantId);
    const settings = readSettings(tenant);
    await applyFeedbackEarnings(event.tenantId, p.feedbackId, p.customerId, settings);
    await dispatchEventWorkflows(event.tenantId, EventTypes.FeedbackSubmitted, { id: p.customerId }, {
      seed: `fb:${p.feedbackId}`,
      source: "feedback submitted",
      feedbackRating: p.rating,
    });
  },

  // ------------------------------------------------ offers
  [EventTypes.OfferCreated]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.OfferCreated]);
    const offer = await db.offer.findFirst({ where: { id: p.offerId, tenantId: event.tenantId } });
    if (offer?.expiresAt) {
      const dueAt = new Date(Math.max(Date.now() + 60_000, offer.expiresAt.getTime() - 3 * 86400_000));
      await db.scheduledAction.create({
        data: {
          tenantId: event.tenantId,
          kind: "offer_expiry_reminder",
          payload: JSON.stringify({ offerId: offer.id }),
          dueAt,
        },
      });
    }
    await dispatchEventWorkflows(event.tenantId, EventTypes.OfferCreated, null, {
      seed: `offer:${p.offerId}`,
      source: "offer created",
    });
  },

  [EventTypes.OfferRedeemed]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.OfferRedeemed]);
    const offer = await db.offer.findFirst({ where: { id: p.offerId, tenantId: event.tenantId } });
    if (offer && offer.kind === "points_bonus" && offer.value > 0) {
      // Exactly-once bonus credit per (offer, customer).
      await creditPoints(event.tenantId, {
        customerId: p.customerId,
        kind: "earn_offer",
        points: offer.value,
        reason: `Bonus for offer: ${offer.title}`,
        idempotencyKey: `offerbonus:${p.offerId}:${p.customerId}`,
      });
    }
    await dispatchEventWorkflows(event.tenantId, EventTypes.OfferRedeemed, { id: p.customerId }, {
      seed: `redeem:${p.redemptionId}`,
      source: "offer redeemed",
    });
  },

  // ------------------------------------------------ campaigns
  [EventTypes.CampaignScheduled]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.CampaignScheduled]);
    const dueAt = p.scheduledAtMs ? new Date(Math.max(Date.now(), p.scheduledAtMs)) : new Date(Date.now() + 5000);
    const pendingRuns = await db.scheduledAction.findMany({
      where: { tenantId: event.tenantId, kind: "campaign_run", status: "pending" },
    });
    const alreadyQueued = pendingRuns.some((a) => {
      try {
        return JSON.parse(a.payload).campaignId === p.campaignId;
      } catch {
        return false;
      }
    });
    if (!alreadyQueued) {
      await db.scheduledAction.create({
        data: {
          tenantId: event.tenantId,
          kind: "campaign_run",
          payload: JSON.stringify({ campaignId: p.campaignId }),
          dueAt,
        },
      });
    }
    await logEvent("info", "campaign", `Campaign ${p.campaignId} scheduled for ${dueAt.toISOString()}`, { campaignId: p.campaignId }, event.tenantId);
  },

  [EventTypes.CampaignCompleted]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.CampaignCompleted]);
    await db.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorLabel: "automation worker",
        action: "campaign.completed",
        entity: "campaign",
        entityId: p.campaignId,
        meta: JSON.stringify({ sent: p.sent, delivered: p.delivered, failed: p.failed, skipped: p.skipped }),
      },
    }).catch(() => undefined);
  },

  // ------------------------------------------------ appointments
  [EventTypes.AppointmentBooked]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentBooked]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);
    const appt = await db.appointment.findFirst({ where: { id: p.appointmentId, tenantId: event.tenantId } });

    // Confirmation (transactional message).
    await sendChannelMessage({
      tenant,
      customer,
      channel: "email",
      kind: "transactional",
      subject: `Your ${tenant.name} appointment is booked`,
      body: `Hi ${customer.name.split(" ")[0]}, your appointment at ${tenant.name} on ${new Date(p.startAtMs).toLocaleString("en-IN", { timeZone: tenant.timezone })} is confirmed. See you soon!`,
      idempotencyKey: `aptconfirm:${p.appointmentId}`,
    }).catch(() => undefined);

    // 24h reminder scheduled action.
    const remindAt = new Date(p.startAtMs - 24 * 3600_000);
    if (remindAt.getTime() > Date.now()) {
      await db.scheduledAction.create({
        data: {
          tenantId: event.tenantId,
          kind: "appointment_reminder",
          payload: JSON.stringify({ appointmentId: p.appointmentId }),
          dueAt: remindAt,
        },
      });
    }

    await dispatchEventWorkflows(event.tenantId, EventTypes.AppointmentBooked, { id: p.customerId }, {
      seed: `apt:${p.appointmentId}`,
      source: "appointment booked",
    });
    void appt;
  },

  [EventTypes.AppointmentCancelled]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentCancelled]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    await sendChannelMessage({
      tenant,
      customer,
      channel: "email",
      kind: "transactional",
      subject: `Your ${tenant.name} appointment was cancelled`,
      body: `Hi ${customer.name.split(" ")[0]}, your appointment at ${tenant.name} has been cancelled (${p.by}). Book again anytime.`,
      idempotencyKey: `aptcancel:${p.appointmentId}`,
    }).catch(() => undefined);

    // Cancel pending reminders/follow-ups for this appointment.
    const actions = await db.scheduledAction.findMany({
      where: { tenantId: event.tenantId, status: "pending", kind: { in: ["appointment_reminder", "post_appointment_followup"] } },
    });
    for (const a of actions) {
      if (JSON.parse(a.payload).appointmentId === p.appointmentId) {
        await db.scheduledAction.update({ where: { id: a.id }, data: { status: "cancelled" } });
      }
    }

    await dispatchEventWorkflows(event.tenantId, EventTypes.AppointmentCancelled, { id: p.customerId }, {
      seed: `aptcancel:${p.appointmentId}`,
      source: `appointment cancelled by ${p.by}`,
    });
  },
};

function zparse<T>(event: OutboxEvent, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T {
  let payload: unknown;
  try {
    payload = JSON.parse(event.payload);
  } catch {
    payload = {};
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload for ${event.type}: ${JSON.stringify(result)}`);
  }
  return result.data as T;
}

export async function publishCampaignCompletedGuard(tenantId: string, campaignId: string, stats: Record<string, number>) {
  return publish(db, { tenantId, type: EventTypes.CampaignCompleted, payload: { campaignId, ...stats }, dedupeKey: `campdone:${campaignId}` });
}
