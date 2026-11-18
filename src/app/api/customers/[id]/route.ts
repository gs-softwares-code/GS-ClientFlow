import { NextRequest } from "next/server";
import { getCustomer, updateCustomer } from "@/server/services/customers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, _request, params) => {
    const customer = await getCustomer(ctx.tenant.id, params.id);
    if (!customer) return jsonError("not_found", "Customer not found in this business", 404);
    return jsonOk({ customer });
  }, { name: "customer-get" })(req);
}

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = await updateCustomer(ctx.tenant.id, params.id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      email: body.email !== undefined ? String(body.email) : undefined,
      phone: body.phone !== undefined ? String(body.phone) : undefined,
      birthday: body.birthday !== undefined ? String(body.birthday) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      status: body.status !== undefined ? String(body.status) : undefined,
      consents: body.consents as Record<string, boolean> | undefined,
    });
    if (!updated) return jsonError("not_found", "Customer not found in this business", 404);
    await audit(ctx, "customer.updated", "customer", params.id, { fields: Object.keys(body) });
    return jsonOk({ customer: updated });
  }, { name: "customer-update" })(req);
}

export const dynamic = "force-dynamic";
