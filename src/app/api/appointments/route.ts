import { NextRequest } from "next/server";
import { listAppointments, bookAppointment, setAppointmentStatus, cancelAppointment } from "@/server/services/appointments";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const appointments = await listAppointments(ctx.tenant.id, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      status: url.searchParams.get("status"),
      customerId: url.searchParams.get("customerId"),
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return jsonOk({ appointments });
  }, { name: "appointments-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    if (!ctx.settings.modules.appointments) {
      return jsonError("module_disabled", "Appointments module is disabled for this business", 409);
    }
    const body = (await request.json().catch(() => ({}))) as {
      customerId?: string; serviceId?: string; staffId?: string; startAt?: string; note?: string;
    };
    if (!body.customerId || !body.startAt) return jsonError("bad_request", "customerId and startAt are required", 400);
    try {
      const appointment = await bookAppointment(ctx.tenant.id, {
        customerId: body.customerId,
        serviceId: body.serviceId ?? null,
        staffId: body.staffId ?? null,
        startAt: body.startAt,
        note: body.note ?? null,
      });
      await audit(ctx, "appointment.booked", "appointment", appointment.id, { startAt: appointment.startAt });
      return jsonOk({ appointment });
    } catch (err) {
      const e = err as Error & { code?: string };
      return jsonError(e.code ?? "bad_request", e.message, 400);
    }
  }, { name: "appointments-book" })(req);
}

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const body = (await request.json().catch(() => ({}))) as { status?: string; cancel?: boolean };
    if (body.cancel) {
      const ok = await cancelAppointment(ctx.tenant.id, id, `staff:${ctx.user.name}`);
      if (ok === null) return jsonError("not_found", "Appointment not found", 404);
      await audit(ctx, "appointment.cancelled", "appointment", id);
      return jsonOk({ ok: true });
    }
    if (body.status) {
      const ok = await setAppointmentStatus(ctx.tenant.id, id, body.status);
      if (ok === null) return jsonError("not_found", "Appointment not found", 404);
      await audit(ctx, `appointment.${body.status}`, "appointment", id);
      return jsonOk({ ok: true });
    }
    return jsonError("bad_request", "Nothing to update", 400);
  }, { name: "appointments-update" })(req);
}

export const dynamic = "force-dynamic";
