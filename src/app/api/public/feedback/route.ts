import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withPublicRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { submitFeedback } from "@/server/services/feedback";
import { verifyTurnstile } from "@/server/lib/turnstile";

export async function POST(req: NextRequest) {
  return withPublicRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string; customerId?: string; rating?: number; comment?: string; turnstileToken?: string;
    };
    if (!body.rating || !body.email) return jsonError("bad_request", "Email and rating (1-5) are required", 400);

    const captcha = await verifyTurnstile(body.turnstileToken);
    if (!captcha.ok) return jsonError("captcha_failed", captcha.reason ?? "Captcha validation failed", 403);

    const customer = body.customerId
      ? await db.customer.findFirst({ where: { id: body.customerId, tenantId: ctx.tenant.id } })
      : await db.customer.findFirst({ where: { tenantId: ctx.tenant.id, email: body.email.trim().toLowerCase() } });
    if (!customer) return jsonError("not_found", "No registration found for this email — register first", 404);

    const feedback = await submitFeedback(ctx.tenant.id, {
      customerId: customer.id,
      rating: body.rating,
      comment: body.comment ?? null,
    });
    await audit(ctx, "feedback.public_submitted", "feedback", feedback.id, { rating: feedback.rating });
    return jsonOk({ feedback: { id: feedback.id, rating: feedback.rating }, message: "Thank you! Your points are being credited." });
  }, { name: "public-feedback", limitPerMinute: 6 })(req);
}

export const dynamic = "force-dynamic";
