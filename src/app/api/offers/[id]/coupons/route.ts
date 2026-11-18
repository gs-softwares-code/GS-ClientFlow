import { NextRequest } from "next/server";
import { generateCoupons } from "@/server/services/offers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const body = (await request.json().catch(() => ({}))) as { count?: number };
    const coupons = await generateCoupons(ctx.tenant.id, params.id, body.count ?? 5, ctx.tenant.name);
    if (!coupons) return jsonError("not_found", "Offer not found in this business", 404);
    await audit(ctx, "offer.coupons_generated", "offer", params.id, { count: coupons.length });
    return jsonOk({ coupons });
  }, { name: "offers-coupons" })(req);
}

export const dynamic = "force-dynamic";
