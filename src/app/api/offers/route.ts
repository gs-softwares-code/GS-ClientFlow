import { NextRequest } from "next/server";
import { createOffer, listOffers, generateCoupons } from "@/server/services/offers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const status = new URL(request.url).searchParams.get("status");
    const offers = await listOffers(ctx.tenant.id, { status });
    return jsonOk({ offers });
  }, { name: "offers-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string; description?: string; kind?: string; value?: number;
      channel?: string; segmentId?: string | null; startsAt?: string; expiresAt?: string;
      generateCoupons?: number;
    };
    if (!body.title?.trim()) return jsonError("bad_request", "Offer title is required", 400);

    const offer = await createOffer(ctx.tenant.id, {
      title: body.title,
      description: body.description ?? null,
      kind: body.kind ?? "discount",
      value: body.value ?? 0,
      channel: body.channel ?? "email",
      segmentId: body.segmentId ?? null,
      startsAt: body.startsAt ?? null,
      expiresAt: body.expiresAt ?? null,
    });
    await audit(ctx, "offer.created", "offer", offer.id, { title: offer.title });

    let coupons: unknown[] = [];
    if (body.generateCoupons && body.generateCoupons > 0) {
      coupons = (await generateCoupons(ctx.tenant.id, offer.id, Math.min(body.generateCoupons, 100), ctx.tenant.name)) ?? [];
    }
    return jsonOk({ offer, coupons });
  }, { name: "offers-create" })(req);
}

export const dynamic = "force-dynamic";
