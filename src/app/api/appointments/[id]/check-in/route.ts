import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { receptionCheckIn } from "@/server/services/appointments";

export async function POST(
  req: NextRequest,
  routeProps?: { params?: Promise<{ id: string }> }
) {
  return withRoute(async (ctx, request, params) => {
    const appointmentId =
      params.id || request.nextUrl.pathname.split("/")[3];

    if (!appointmentId) {
      return jsonError("bad_request", "Appointment ID is required", 400);
    }

    try {
      const appt = await receptionCheckIn(ctx.tenant.id, appointmentId);

      let preferences = {};
      try {
        preferences = JSON.parse(appt.preferences);
      } catch {}

      await audit(ctx, "appointment.reception_checkin", "appointment", appointmentId, {
        customerName: appt.customer.name,
        stylistName: appt.assignedStaff?.name ?? null,
      });

      return jsonOk({
        success: true,
        checkedInAt: appt.checkedInAt,
        appointment: {
          id: appt.id,
          customerName: appt.customer.name,
          customerPhone: appt.customer.phone,
          serviceName: appt.service?.name,
          assignedStaff: appt.assignedStaff ? {
            id: appt.assignedStaff.id,
            name: appt.assignedStaff.name,
            role: appt.assignedStaff.role,
          } : null,
          preferences,
          checkInStatus: appt.checkInStatus,
        },
        message: `Welcome ${appt.customer.name}! Staff notified and preferences loaded.`,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      return jsonError(e.code ?? "bad_request", e.message, 400);
    }
  }, { name: "appointment-checkin", limitPerMinute: 60 })(req);
}

export const dynamic = "force-dynamic";
