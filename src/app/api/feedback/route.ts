import { NextRequest } from "next/server";
import { submitFeedback, listFeedback } from "@/server/services/feedback";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const result = await listFeedback(ctx.tenant.id, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? 25),
      minRating: url.searchParams.get("minRating") ? Number(url.searchParams.get("minRating")) : null,
      maxRating: url.searchParams.get("maxRating") ? Number(url.searchParams.get("maxRating")) : null,
      status: url.searchParams.get("status"),
      customerId: url.searchParams.get("customerId"),
    });
    return jsonOk(result);
  }, { name: "feedback-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { customerId?: string; rating?: number; comment?: string };
    if (!body.customerId || !body.rating) return jsonError("bad_request", "customerId and rating (1-5) are required", 400);
    const feedback = await submitFeedback(ctx.tenant.id, {
      customerId: body.customerId,
      rating: body.rating,
      comment: body.comment ?? null,
    });
    await audit(ctx, "feedback.submitted", "feedback", feedback.id, { rating: feedback.rating });
    return jsonOk({ feedback });
  }, { name: "feedback-create" })(req);
}

export const dynamic = "force-dynamic";
