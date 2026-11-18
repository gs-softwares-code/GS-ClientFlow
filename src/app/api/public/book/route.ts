import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withPublicRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { bookAppointment } from "@/server/services/appointments";
import { verifyTurnstile } from "@/server/lib/turnstile";

/** Public booking (find-or-create the customer by email). */
export async function POST(req: NextRequest) {
  return withPublicRoute(async (ctx, request) => {
    if (!ctx.settings.modules.appointments) {
      return jsonError("module_disabled", "This business does not take online bookings", 409);
    }
    const body = (await request.json().catch(() => ({}))) as {
      email?: string; name?: string; phone?: string; serviceId?: string; staffId?: string;
      startAt?: string; note?: string; turnstileToken?: string;
    };
    if (!body.email || !body.startAt || !body.serviceId) {
      return jsonError("bad_request", "Email, service and start time are required", 400);
    }
    const captcha = await verifyTurnstile(body.turnstileToken);
    if (!captcha.ok) return jsonError("captcha_failed", captcha.reason ?? "Captcha validation failed", 403);

    let customer = await db.customer.findFirst({ where: { tenantId: ctx.tenant.id, email: body.email.trim().toLowerCase() } });
    if (!customer) {
      if (!body.name?.trim()) return jsonError("bad_request", "Name is required for new bookings", 400);
      const { createCustomer } = await import("@/server/services/customers");
      customer = await createCustomer(ctx.tenant.id, {
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        source: "website",
        consents: { marketing: true, email: true, sms: false, whatsapp: false },
        notes: body.note ? `Booking note: ${body.note}` : null,
      });
    }

    try {
      const appointment = await bookAppointment(ctx.tenant.id, {
        customerId: customer.id,
        serviceId: body.serviceId,
        staffId: body.staffId ?? null,
        startAt: body.startAt,
        note: body.note ?? null,
      });
      await audit(ctx, "appointment.public_booked", "appointment", appointment.id, { customer: customer.name });
      return jsonOk({
        appointment: { id: appointment.id, startAt: appointment.startAt, durationMin: appointment.durationMin },
        message: "Booked! A confirmation is on its way, plus a reminder before your visit.",
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      return jsonError(e.code ?? "bad_request", e.message, 400);
    }
  }, { name: "public-book", limitPerMinute: 6 })(req);
}

export const dynamic = "force-dynamic";
