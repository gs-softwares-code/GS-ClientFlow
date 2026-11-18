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
} satisfies Record<EventType, z.ZodTypeAny>;
