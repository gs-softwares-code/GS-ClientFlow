import { NextRequest } from "next/server";
import { withPublicRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { createCustomer } from "@/server/services/customers";
import { verifyTurnstile } from "@/server/lib/turnstile";

/** Public customer self-registration (the tenant is resolved from the slug). */
export async function POST(req: NextRequest) {
  return withPublicRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string; email?: string; phone?: string; birthday?: string;
      referredByCode?: string; consentMarketing?: boolean; consentSms?: boolean; consentWhatsapp?: boolean;
      concern?: string; turnstileToken?: string;
    };
    if (!body.name?.trim() || !body.email?.trim()) return jsonError("bad_request", "Name and email are required", 400);

    const captcha = await verifyTurnstile(body.turnstileToken);
    if (!captcha.ok) return jsonError("captcha_failed", captcha.reason ?? "Captcha validation failed", 403);

    try {
      const customer = await createCustomer(ctx.tenant.id, {
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        birthday: body.birthday ?? null,
        source: body.referredByCode ? "referral" : "website",
        referredByCode: body.referredByCode ?? null,
        consents: {
          marketing: body.consentMarketing ?? true,
          email: true,
          sms: body.consentSms ?? false,
          whatsapp: body.consentWhatsapp ?? false,
        },
        notes: body.concern ? `Registration note: ${body.concern}` : null,
      });
      await audit(ctx, "customer.self_registered", "customer", customer.id, { source: "public form" });
      return jsonOk({
        customer: { id: customer.id, name: customer.name },
        message: `Welcome, ${customer.name.split(" ")[0]}! Your welcome message is on its way.`,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "duplicate") return jsonError("duplicate", "You are already registered with this email", 409);
      throw err;
    }
  }, { name: "public-register", limitPerMinute: 8 })(req);
}

export const dynamic = "force-dynamic";
