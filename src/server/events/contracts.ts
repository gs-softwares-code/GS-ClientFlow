import { z } from "zod";

/** Event contracts — the outbox event catalog (typed payloads, zod-validated). */

export const EventTypes = {
  CustomerRegistered: "customer.registered",
  CustomerUpdated: "customer.updated",
  CustomerBirthdayUpcoming: "customer.birthday.upcoming",
  FeedbackSubmitted: "feedback.submitted",
  OfferCreated: "offer.created",
  OfferRedeemed: "offer.redeemed",
  CampaignScheduled: "campaign.scheduled",
  CampaignCompleted: "campaign.completed",
  AppointmentBooked: "appointment.booked",
  AppointmentCancelled: "appointment.cancelled",
  // Vertical 1: Coaching Institute Attendance & Parent Escalation
  AttendanceMarkedAbsent: "attendance.marked_absent",
  AttendanceGuardianReplied: "attendance.guardian_replied",
  AttendanceNoReplyTimeout: "attendance.no_reply_timeout",
  // Vertical 2: Gym Membership Expiry & Daily Digest
  MembershipCreatedOrUpdated: "membership.created_or_updated",
  MembershipExpiringSoon: "membership.expiring_soon",
  MembershipPaymentReceived: "membership.payment_received",
  OpsDailyGymSummary: "ops.daily_gym_summary",
  // Vertical 3: Smart Salon Booking & Reception Check-In
  AppointmentBookedSmart: "appointment.booked_smart",
  AppointmentReminder24h: "appointment.reminder_24h",
  AppointmentReceptionCheckedIn: "appointment.reception_checked_in",
  AppointmentServiceCompleted: "appointment.service_completed",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const EVENT_CATALOG: { type: EventType; description: string; source: string }[] = [
  { type: EventTypes.CustomerRegistered, description: "Emitted transactionally when a customer is created (staff or public registration).", source: "customers service" },
  { type: EventTypes.CustomerUpdated, description: "Emitted when profile data or aggregates (visits, spend, points) change.", source: "customers service" },
  { type: EventTypes.CustomerBirthdayUpcoming, description: "Emitted by the date-trigger scheduler N days before a customer's birthday (yearly dedupe).", source: "scheduler" },
  { type: EventTypes.FeedbackSubmitted, description: "Emitted when feedback is submitted (public form or staff).", source: "feedback service" },
  { type: EventTypes.OfferCreated, description: "Emitted when an offer is created and published.", source: "offers service" },
  { type: EventTypes.OfferRedeemed, description: "Emitted after a successful (idempotent) offer redemption.", source: "offers service" },
  { type: EventTypes.CampaignScheduled, description: "Emitted when a campaign moves to the scheduled state.", source: "campaigns service" },
  { type: EventTypes.CampaignCompleted, description: "Emitted after the worker finishes executing a campaign.", source: "worker" },
  { type: EventTypes.AppointmentBooked, description: "Emitted when an appointment is booked (public or staff).", source: "appointments service" },
  { type: EventTypes.AppointmentCancelled, description: "Emitted when an appointment is cancelled.", source: "appointments service" },
  // Vertical 1: Coaching
  { type: EventTypes.AttendanceMarkedAbsent, description: "Emitted when a student is marked absent, initiating automated guardian WhatsApp contact.", source: "attendance service" },
  { type: EventTypes.AttendanceGuardianReplied, description: "Emitted when a guardian replies to an absentee notification with Leave or Late arrival.", source: "webhooks" },
  { type: EventTypes.AttendanceNoReplyTimeout, description: "Emitted after a timeout with no guardian response, creating a high-priority staff task.", source: "worker" },
  // Vertical 2: Gym
  { type: EventTypes.MembershipCreatedOrUpdated, description: "Emitted when a gym membership is purchased or renewed.", source: "membership service" },
  { type: EventTypes.MembershipExpiringSoon, description: "Emitted when a membership is 7, 3, or 1 day(s) from expiration.", source: "scheduler" },
  { type: EventTypes.MembershipPaymentReceived, description: "Emitted when a gym membership payment is settled.", source: "membership service" },
  { type: EventTypes.OpsDailyGymSummary, description: "Emitted daily to compile and dispatch an executive metrics digest to gym owners.", source: "scheduler" },
  // Vertical 3: Salon
  { type: EventTypes.AppointmentBookedSmart, description: "Emitted when an appointment is auto-assigned to an optimal stylist with ambient preferences.", source: "appointments service" },
  { type: EventTypes.AppointmentReminder24h, description: "Emitted 24 hours prior to service with a self-service reschedule link.", source: "scheduler" },
  { type: EventTypes.AppointmentReceptionCheckedIn, description: "Emitted when a client arrives at the salon kiosk, alerting the assigned stylist.", source: "reception kiosk" },
  { type: EventTypes.AppointmentServiceCompleted, description: "Emitted when salon service concludes, triggering retention discount & feedback loop.", source: "appointments service" },
];

const id = z.string().min(1);

// Literal-keyed so each schema keeps its precise inferred type.
export const PayloadSchemas = {
  [EventTypes.CustomerRegistered]: z.object({
    customerId: id,
    publicId: z.string(),
    name: z.string(),
    email: z.string(),
    source: z.string().optional(),
    referredByCode: z.string().nullable().optional(),
  }),
  [EventTypes.CustomerUpdated]: z.object({
    customerId: id,
    reason: z.string(),
  }),
  [EventTypes.CustomerBirthdayUpcoming]: z.object({
    customerId: id,
    name: z.string(),
    birthdayMonth: z.number(),
    birthdayDay: z.number(),
    leadDays: z.number(),
    occurrenceYear: z.number().optional(),
  }),
  [EventTypes.FeedbackSubmitted]: z.object({
    feedbackId: id,
    customerId: id,
    rating: z.number().min(1).max(5),
  }),
  [EventTypes.OfferCreated]: z.object({ offerId: id, title: z.string(), kind: z.string() }),
  [EventTypes.OfferRedeemed]: z.object({
    redemptionId: id,
    offerId: id,
    customerId: id,
    couponCode: z.string().nullable().optional(),
  }),
  [EventTypes.CampaignScheduled]: z.object({ campaignId: id, scheduledAtMs: z.number().optional() }),
  [EventTypes.CampaignCompleted]: z.object({
    campaignId: id,
    sent: z.number(),
    delivered: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
  [EventTypes.AppointmentBooked]: z.object({ appointmentId: id, customerId: id, startAtMs: z.number() }),
  [EventTypes.AppointmentCancelled]: z.object({ appointmentId: id, customerId: id, by: z.string() }),
  // Vertical 1 Schemas
  [EventTypes.AttendanceMarkedAbsent]: z.object({
    attendanceId: id,
    customerId: id,
    studentName: z.string(),
    guardianPhone: z.string(),
    batchOrClass: z.string(),
    date: z.string(),
  }),
  [EventTypes.AttendanceGuardianReplied]: z.object({
    attendanceId: id,
    customerId: id,
    replyType: z.enum(["LEAVE", "LATE", "OTHER"]),
    rawMessage: z.string(),
  }),
  [EventTypes.AttendanceNoReplyTimeout]: z.object({
    attendanceId: id,
    customerId: id,
    guardianPhone: z.string(),
  }),
  // Vertical 2 Schemas
  [EventTypes.MembershipCreatedOrUpdated]: z.object({
    membershipId: id,
    customerId: id,
    planName: z.string(),
    expiryDate: z.string(),
    paymentStatus: z.string(),
  }),
  [EventTypes.MembershipExpiringSoon]: z.object({
    membershipId: id,
    customerId: id,
    daysRemaining: z.number(),
    renewalLink: z.string().optional(),
  }),
  [EventTypes.MembershipPaymentReceived]: z.object({
    membershipId: id,
    customerId: id,
    amount: z.number(),
  }),
  [EventTypes.OpsDailyGymSummary]: z.object({
    date: z.string(),
    activeCount: z.number(),
    expiredCount: z.number(),
    pendingDuesAmount: z.number(),
    expiringIn7DaysCount: z.number(),
  }),
  // Vertical 3 Schemas
  [EventTypes.AppointmentBookedSmart]: z.object({
    appointmentId: id,
    customerId: id,
    assignedStaffId: z.string().nullable().optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
  }),
  [EventTypes.AppointmentReminder24h]: z.object({
    appointmentId: id,
    customerId: id,
    rescheduleUrl: z.string().optional(),
  }),
  [EventTypes.AppointmentReceptionCheckedIn]: z.object({
    appointmentId: id,
    customerId: id,
    assignedStaffId: z.string().nullable().optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
  }),
  [EventTypes.AppointmentServiceCompleted]: z.object({
    appointmentId: id,
    customerId: id,
    feedbackUrl: z.string().optional(),
    rebookIncentiveCode: z.string().optional(),
  }),
} satisfies Record<EventType, z.ZodTypeAny>;
