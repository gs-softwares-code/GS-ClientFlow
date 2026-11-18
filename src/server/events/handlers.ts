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
import { safeFetch } from "@/server/lib/ssrf";

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

  // ------------------------------------------------ Vertical 1: Coaching Institute
  [EventTypes.AttendanceMarkedAbsent]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AttendanceMarkedAbsent]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);
    const settings = readSettings(tenant);
    const timeoutMin = settings.vertical?.coaching?.parentReplyTimeoutMin ?? 60;

    // 1. Dispatch automated WhatsApp to guardian
    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Attendance Alert: ${p.studentName}`,
      body: `Hello from ${tenant.name}. Your ward ${p.studentName} was marked ABSENT today (${p.date}) for ${p.batchOrClass}.\n\nPlease reply with:\n1 for On Leave\n2 for Running Late`,
      idempotencyKey: `att_absent_msg:${p.attendanceId}`,
      requireConsent: false,
    }).catch(() => undefined);

    // 2. Schedule verification check after timeout (default: 60 minutes)
    await db.scheduledAction.create({
      data: {
        tenantId: event.tenantId,
        kind: "attendance_no_reply_check",
        payload: JSON.stringify({
          attendanceId: p.attendanceId,
          customerId: p.customerId,
          guardianPhone: p.guardianPhone,
        }),
        dueAt: new Date(Date.now() + timeoutMin * 60_000),
      },
    });

    await dispatchEventWorkflows(event.tenantId, EventTypes.AttendanceMarkedAbsent, { id: p.customerId }, {
      seed: `att_absent:${p.attendanceId}`,
      source: "attendance service",
    });
  },

  [EventTypes.AttendanceGuardianReplied]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AttendanceGuardianReplied]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    // Send acknowledgment back to parent
    const ackText =
      p.replyType === "LEAVE"
        ? `Leave acknowledged for ${customer.name}. Thank you for informing ${tenant.name}.`
        : `Late arrival recorded for ${customer.name}. See you soon!`;

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      body: ackText,
      idempotencyKey: `att_reply_ack:${p.attendanceId}:${Date.now()}`,
      requireConsent: false,
    }).catch(() => undefined);

    await dispatchEventWorkflows(event.tenantId, EventTypes.AttendanceGuardianReplied, { id: p.customerId }, {
      seed: `att_reply:${p.attendanceId}`,
      source: "inbound parent message",
    });
  },

  [EventTypes.AttendanceNoReplyTimeout]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AttendanceNoReplyTimeout]);
    const att = await db.attendanceLog.findFirst({
      where: { id: p.attendanceId, tenantId: event.tenantId },
    });
    if (!att || att.guardianReplyStatus !== "PENDING") return;

    // Escalate: mark NO_REPLY and create high-priority staff task
    const task = await db.staffFollowUpTask.create({
      data: {
        tenantId: event.tenantId,
        customerId: p.customerId,
        taskType: "ATTENDANCE_CALL",
        status: "OPEN",
        dueAt: new Date(),
        notes: `URGENT ESCALATION: Parent did not respond to absence WhatsApp alert. Call guardian at ${p.guardianPhone}.`,
      },
    });

    await db.attendanceLog.update({
      where: { id: att.id },
      data: {
        guardianReplyStatus: "NO_REPLY",
        followUpTaskId: task.id,
      },
    });

    await logEvent(
      "warn",
      "attendance",
      `Parent escalation task created for student ${p.customerId} (No reply in 60m)`,
      { taskId: task.id },
      event.tenantId
    );
  },

  // ------------------------------------------------ Vertical 2: Gym Membership
  [EventTypes.MembershipCreatedOrUpdated]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.MembershipCreatedOrUpdated]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Welcome to ${tenant.name} Gym`,
      body: `Hi ${customer.name.split(" ")[0]}, your ${p.planName} membership is confirmed! Valid until ${new Date(p.expiryDate).toLocaleDateString("en-IN")}. Work out hard!`,
      idempotencyKey: `memb_conf:${p.membershipId}`,
    }).catch(() => undefined);

    await dispatchEventWorkflows(event.tenantId, EventTypes.MembershipCreatedOrUpdated, { id: p.customerId }, {
      seed: `memb_create:${p.membershipId}`,
      source: "membership service",
    });
  },

  [EventTypes.MembershipExpiringSoon]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.MembershipExpiringSoon]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    const renewalUrl = p.renewalLink || `https://${tenant.slug}.gsclientflow.app/portal?renew=${p.membershipId}`;

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Membership Expiring in ${p.daysRemaining} days`,
      body: `Hi ${customer.name.split(" ")[0]}, your ${tenant.name} gym membership expires in ${p.daysRemaining} day(s). Renew now to lock in your current rate: ${renewalUrl}`,
      idempotencyKey: `memb_exp_msg:${p.membershipId}:${p.daysRemaining}`,
    }).catch(() => undefined);

    // If 1 day remaining, create a renewal staff task for front desk
    if (p.daysRemaining <= 1) {
      await db.staffFollowUpTask.create({
        data: {
          tenantId: event.tenantId,
          customerId: p.customerId,
          taskType: "GYM_RENEWAL_CALL",
          status: "OPEN",
          dueAt: new Date(),
          notes: `Call member ${customer.name} (${customer.phone || customer.email}) — membership expires tomorrow.`,
        },
      });
    }

    await dispatchEventWorkflows(event.tenantId, EventTypes.MembershipExpiringSoon, { id: p.customerId }, {
      seed: `memb_exp:${p.membershipId}:${p.daysRemaining}`,
      source: "membership scheduler",
    });
  },

  [EventTypes.MembershipPaymentReceived]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.MembershipPaymentReceived]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Payment Receipt: ₹${(p.amount / 100).toFixed(2)}`,
      body: `Thank you ${customer.name.split(" ")[0]}! We have received your payment of ₹${(p.amount / 100).toFixed(2)} for ${tenant.name}. See you on the floor!`,
      idempotencyKey: `memb_pay_receipt:${p.membershipId}:${Date.now()}`,
    }).catch(() => undefined);
  },

  [EventTypes.OpsDailyGymSummary]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.OpsDailyGymSummary]);
    const tenant = await tenantOf(event.tenantId);
    const owner = await db.user.findFirst({ where: { tenantId: event.tenantId, role: "owner" } });
    if (!owner) return;

    const summaryText =
      `📊 *${tenant.name} Daily Operations Digest (${p.date})*\n\n` +
      `• Active Members: *${p.activeCount}*\n` +
      `• Expiring in 7 Days: *${p.expiringIn7DaysCount}*\n` +
      `• Expired Subscriptions: *${p.expiredCount}*\n` +
      `• Pending Uncollected Dues: *₹${(p.pendingDuesAmount / 100).toLocaleString("en-IN")}*\n\n` +
      `Keep crushing it! Manage ledger in your ClientFlow dashboard.`;

    await sendChannelMessage({
      tenant,
      customer: { id: owner.id, name: owner.name, email: owner.email, phone: null, consents: "{}" },
      channel: "email",
      kind: "transactional",
      subject: `Daily Operations Digest: ${tenant.name} (${p.date})`,
      body: summaryText,
      idempotencyKey: `ops_gym_summary:${tenant.id}:${p.date}`,
      requireConsent: false,
    }).catch(() => undefined);
  },

  // ------------------------------------------------ Vertical 3: Smart Salon
  [EventTypes.AppointmentBookedSmart]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentBookedSmart]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    let stylistName = "our top stylist";
    if (p.assignedStaffId) {
      const staffMember = await db.staffMember.findFirst({
        where: { id: p.assignedStaffId, tenantId: event.tenantId },
      });
      if (staffMember) stylistName = staffMember.name;
    }

    const prefs = (p.preferences || {}) as { musicGenre?: string; beverage?: string };
    const ambientDetails = prefs.beverage || prefs.musicGenre
      ? ` We have queued your preferred ${prefs.beverage || "refreshment"} and ${prefs.musicGenre || "music"} playlist!`
      : "";

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Your Booking with ${stylistName}`,
      body: `Hi ${customer.name.split(" ")[0]}, your appointment at ${tenant.name} is confirmed with stylist ${stylistName}.${ambientDetails}`,
      idempotencyKey: `apt_smart_conf:${p.appointmentId}`,
    }).catch(() => undefined);

    await dispatchEventWorkflows(event.tenantId, EventTypes.AppointmentBookedSmart, { id: p.customerId }, {
      seed: `apt_smart:${p.appointmentId}`,
      source: "smart booking engine",
    });
  },

  [EventTypes.AppointmentReminder24h]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentReminder24h]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    const rescheduleLink = p.rescheduleUrl || `https://${tenant.slug}.gsclientflow.app/portal`;

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `24h Reminder: Appointment at ${tenant.name}`,
      body: `Hi ${customer.name.split(" ")[0]}, reminding you of your visit tomorrow at ${tenant.name}. Need to reschedule? Tap here: ${rescheduleLink}`,
      idempotencyKey: `apt_rem24h:${p.appointmentId}`,
    }).catch(() => undefined);
  },

  [EventTypes.AppointmentReceptionCheckedIn]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentReceptionCheckedIn]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);
    const settings = readSettings(tenant);

    // 1. Notify assigned stylist
    if (p.assignedStaffId) {
      const staffMember = await db.staffMember.findFirst({
        where: { id: p.assignedStaffId, tenantId: event.tenantId },
      });
      if (staffMember && staffMember.phone) {
        const prefs = (p.preferences || {}) as { haircutStyle?: string; beverage?: string; musicGenre?: string };
        const alertMsg =
          `✂️ *CLIENT ARRIVED*: ${customer.name} is here!\n` +
          `• Style: ${prefs.haircutStyle || "Standard cut"}\n` +
          `• Beverage: ${prefs.beverage || "Water"}\n` +
          `• Music: ${prefs.musicGenre || "Default"}`;

        await sendChannelMessage({
          tenant,
          customer: { id: staffMember.id, name: staffMember.name, email: "", phone: staffMember.phone, consents: "{}" },
          channel: "whatsapp",
          kind: "transactional",
          body: alertMsg,
          idempotencyKey: `stylist_checkin_alert:${p.appointmentId}`,
          requireConsent: false,
        }).catch(() => undefined);
      }
    }

    // 2. Fire ambient IoT controller webhook if configured
    const ambientUrl = settings.vertical?.salon?.ambientIotWebhookUrl;
    if (ambientUrl) {
      try {
        await safeFetch(ambientUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "client_check_in",
            clientName: customer.name,
            preferences: p.preferences,
            timestamp: new Date().toISOString(),
          }),
        }, { allowHttpInDev: true });
      } catch (err) {
        await logEvent("warn", "salon", `Ambient IoT trigger failed: ${(err as Error).message}`, { appointmentId: p.appointmentId }, event.tenantId);
      }
    }

    await dispatchEventWorkflows(event.tenantId, EventTypes.AppointmentReceptionCheckedIn, { id: p.customerId }, {
      seed: `apt_checkin:${p.appointmentId}`,
      source: "reception kiosk",
    });
  },

  [EventTypes.AppointmentServiceCompleted]: async (event) => {
    const p = zparse(event, PayloadSchemas[EventTypes.AppointmentServiceCompleted]);
    const tenant = await tenantOf(event.tenantId);
    const customer = await customerOf(event.tenantId, p.customerId);

    // Reward points for service completion
    await creditPoints(event.tenantId, {
      customerId: p.customerId,
      kind: "service_completed",
      points: 50,
      reason: "Appointment completed bonus",
      idempotencyKey: `service_pts:${p.appointmentId}`,
    });

    // Generate referral code for rebooking discount
    const discountCode = (await ensureReferralCode(event.tenantId, p.customerId, customer.name)) || "RETURN10";

    const feedbackUrl = p.feedbackUrl || `https://${tenant.slug}.gsclientflow.app/public/feedback?email=${encodeURIComponent(customer.email)}`;

    await sendChannelMessage({
      tenant,
      customer,
      channel: "whatsapp",
      kind: "transactional",
      subject: `Thank you for visiting ${tenant.name}!`,
      body: `Hi ${customer.name.split(" ")[0]}, thank you for visiting ${tenant.name}! Rate your experience: ${feedbackUrl}\n\nUse code *${discountCode}* for 10% off your next booking!`,
      idempotencyKey: `apt_serv_done:${p.appointmentId}`,
    }).catch(() => undefined);

    await dispatchEventWorkflows(event.tenantId, EventTypes.AppointmentServiceCompleted, { id: p.customerId }, {
      seed: `apt_done:${p.appointmentId}`,
      source: "service completion",
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
