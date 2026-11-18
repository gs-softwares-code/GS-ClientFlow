import { NextRequest } from "next/server";
import { redeemOffer, listCoupons } from "@/server/services/offers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const coupons = await listCoupons(ctx.tenant.id, {
      status: url.searchParams.get("status"),
      offerId: url.searchParams.get("offerId"),
      customerId: url.searchParams.get("customerId"),
    });
    return jsonOk({ coupons });
  }, { name: "redeem-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { offerId?: string; customerId?: string; couponCode?: string };
    if (!body.offerId || !body.customerId) return jsonError("bad_request", "offerId and customerId are required", 400);
    try {
      const result = await redeemOffer(ctx.tenant.id, {
        offerId: body.offerId,
        customerId: body.customerId,
        couponCode: body.couponCode ?? null,
      });
      await audit(ctx, "offer.redeemed", "offerRedemption", String(result.redemptionId), { offerId: body.offerId, customerId: body.customerId, duplicate: result.duplicate });
      return jsonOk({ ...result, message: result.duplicate ? "Already redeemed (idempotent guard)" : "Redeemed" });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "duplicate") return jsonError("duplicate", e.message, 409);
      return jsonError(e.code ?? "bad_request", e.message, 400);
    }
  }, { name: "redeem-offer" })(req);
}

export const dynamic = "force-dynamic";
