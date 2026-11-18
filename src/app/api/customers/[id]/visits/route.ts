import { NextRequest } from "next/server";
import { addVisit } from "@/server/services/customers";
import { applyVisitEarnings } from "@/server/services/loyalty";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const body = (await request.json().catch(() => ({}))) as { amountRupees?: number; note?: string; occurredAt?: string };
    const visit = await addVisit(ctx.tenant.id, params.id, {
      amountCents: Math.round((body.amountRupees ?? 0) * 100),
      note: body.note,
      occurredAt: body.occurredAt,
    });
    if (!visit) return jsonError("not_found", "Customer not found in this business", 404);

    // Loyalty earnings for the visit (idempotent via visit:{id} key).
    const customer = await import("@/lib/db").then((m) =>
      m.db.customer.findFirst({ where: { id: params.id, tenantId: ctx.tenant.id }, select: { id: true, name: true } })
    );
    const loyalty = customer ? await applyVisitEarnings(ctx.tenant.id, customer, visit.id, visit.amountCents, ctx.settings) : null;

    await audit(ctx, "visit.recorded", "visit", visit.id, { amountCents: visit.amountCents, loyalty });
    return jsonOk({ visit, loyalty });
  }, { name: "customer-visit" })(req);
}

export const dynamic = "force-dynamic";
