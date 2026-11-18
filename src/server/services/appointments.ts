import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { readSettings } from "@/server/settings";

/** Appointment service — module is optional per tenant (settings.modules.appointments). */

export async function bookAppointment(
  tenantId: string,
  input: {
    customerId: string;
    serviceId?: string | null;
    staffId?: string | null;
    startAt: string;
    note?: string | null;
  }
) {
  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) {
    throw Object.assign(new Error("Appointment must be in the future"), { code: "invalid_time" });
  }
  const service = input.serviceId
    ? await db.service.findFirst({ where: { id: input.serviceId, tenantId, active: true } })
    : null;
  const durationMin = service?.durationMin ?? 30;
  const end = new Date(start.getTime() + durationMin * 60_000);

  // Slot conflict check: same staff cannot double-book overlapping windows.
  if (input.staffId) {
    const conflicts = await db.appointment.findMany({
      where: {
        tenantId,
        staffId: input.staffId,
        status: { in: ["scheduled", "confirmed"] },
        startAt: { lt: end },
      },
      select: { startAt: true, durationMin: true },
    });
    const overlap = conflicts.some((c) => new Date(c.startAt.getTime() + c.durationMin * 60_000) > start);
    if (overlap) {
      throw Object.assign(new Error("This slot is already booked for the selected staff member"), { code: "slot_conflict" });
    }
  }

  return db.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        tenantId,
        customerId: input.customerId,
        serviceId: service?.id ?? null,
        staffId: input.staffId ?? null,
        startAt: start,
        durationMin,
        status: "scheduled",
        note: input.note?.trim() || null,
      },
    });
    await publish(tx, {
      tenantId,
      type: EventTypes.AppointmentBooked,
      payload: { appointmentId: created.id, customerId: input.customerId, startAtMs: start.getTime() },
      dedupeKey: `aptbook:${created.id}`,
    });
    return created;
  });
}

export async function cancelAppointment(tenantId: string, appointmentId: string, by: string) {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, tenantId } });
  if (!appt) return null;
  if (appt.status === "completed") {
    throw Object.assign(new Error("Completed appointments cannot be cancelled"), { code: "invalid_state" });
  }
  await db.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appointmentId }, data: { status: "cancelled" } });
    await publish(tx, {
      tenantId,
      type: EventTypes.AppointmentCancelled,
      payload: { appointmentId, customerId: appt.customerId, by },
      dedupeKey: `aptcancel:${appointmentId}`,
    });
  });
  return true;
}

export async function setAppointmentStatus(tenantId: string, appointmentId: string, status: string) {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, tenantId } });
  if (!appt) return null;
  await db.appointment.update({ where: { id: appointmentId }, data: { status } });
  if (status === "completed") {
    // post-appointment follow-up: feedback request 2 hours later
    await db.scheduledAction.create({
      data: {
        tenantId,
        kind: "post_appointment_followup",
        payload: JSON.stringify({ appointmentId, customerId: appt.customerId }),
        dueAt: new Date(Date.now() + 2 * 3600_000),
      },
    });
  }
  return true;
}

export async function listAppointments(
  tenantId: string,
  opts: { from?: string | null; to?: string | null; status?: string | null; customerId?: string | null; limit?: number }
) {
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  if (opts.customerId) where.customerId = opts.customerId;
  if (opts.from || opts.to) {
    where.startAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to ? { lte: new Date(opts.to) } : {}),
    };
  }
  return db.appointment.findMany({
    where,
    orderBy: { startAt: "asc" },
    take: Math.min(opts.limit ?? 100, 300),
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      service: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
    },
  });
}

export async function upcomingRemindersPreview(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return [];
  const settings = readSettings(tenant);
  const from = new Date();
  const to = new Date(Date.now() + 3 * 86400_000);
  return db.appointment.findMany({
    where: { tenantId, status: { in: ["scheduled", "confirmed"] }, startAt: { gte: from, lte: to }, reminderSentAt: null },
    orderBy: { startAt: "asc" },
    take: 20,
    include: { customer: { select: { id: true, name: true } }, service: { select: { name: true } } },
  });
}
