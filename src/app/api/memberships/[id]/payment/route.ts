import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { updateMembershipPayment } from "@/server/services/memberships";
import { z } from "zod";

const PaymentStatusSchema = z.object({
  paymentStatus: z.enum(["PAID", "PENDING", "OVERDUE"]),
});

export async function PATCH(
  req: NextRequest,
  routeProps?: { params?: Promise<{ id: string }> }
) {
  return withRoute(async (ctx, request, params) => {
    // Resilient extraction of ID from URL if params is empty
    const membershipId =
      params.id || request.nextUrl.pathname.split("/")[3];

    if (!membershipId) {
      return jsonError("bad_request", "Membership ID is required", 400);
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = PaymentStatusSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError("bad_request", parsed.error.issues?.[0]?.message ?? "Invalid payment status", 400);
    }

    const updated = await updateMembershipPayment(
      ctx.tenant.id,
      membershipId,
      parsed.data.paymentStatus
    );

    if (!updated) {
      return jsonError("not_found", "Membership not found in this business", 404);
    }

    await audit(ctx, "membership.payment_updated", "membership", membershipId, {
      status: parsed.data.paymentStatus,
    });

    return jsonOk({
      success: true,
      membership: updated,
    });
  }, { name: "membership-payment-patch" })(req);
}

export const dynamic = "force-dynamic";
