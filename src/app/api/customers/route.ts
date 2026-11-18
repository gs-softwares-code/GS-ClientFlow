import { NextRequest } from "next/server";
import { listCustomers, createCustomer } from "@/server/services/customers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { withinQuota } from "@/server/usage";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const result = await listCustomers(ctx.tenant.id, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? 25),
      search: url.searchParams.get("search"),
      segmentId: url.searchParams.get("segmentId"),
      tagId: url.searchParams.get("tagId"),
      status: url.searchParams.get("status"),
      source: url.searchParams.get("source"),
      birthdayWithinDays: url.searchParams.get("birthdayWithinDays") ? Number(url.searchParams.get("birthdayWithinDays")) : null,
      inactiveWithinDays: url.searchParams.get("inactiveWithinDays") ? Number(url.searchParams.get("inactiveWithinDays")) : null,
    });
    return jsonOk(result);
  }, { name: "customers-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body.name || !body.email) return jsonError("bad_request", "Name and email are required", 400);
    const ok = await withinQuota(ctx.tenant.id, ctx.tenant.plan, "customers");
    if (!ok) return jsonError("quota_exceeded", "Customer limit reached for this plan — upgrade to add more", 402);

    try {
      const customer = await createCustomer(ctx.tenant.id, {
        name: String(body.name),
        email: String(body.email),
        phone: body.phone ? String(body.phone) : null,
        birthday: body.birthday ? String(body.birthday) : null,
        source: body.source ? String(body.source) : undefined,
        referredByCode: body.referredByCode ? String(body.referredByCode) : null,
        consents: (body.consents as Record<string, boolean>) ?? undefined,
        notes: body.notes ? String(body.notes) : null,
      });
      await audit(ctx, "customer.created", "customer", customer.id, { name: customer.name });
      return jsonOk({ customer });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "duplicate") return jsonError("duplicate", e.message, 409);
      throw err;
    }
  }, { name: "customers-create" })(req);
}

export const dynamic = "force-dynamic";
