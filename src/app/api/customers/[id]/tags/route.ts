import { NextRequest } from "next/server";
import { setCustomerTags } from "@/server/services/customers";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const body = (await request.json().catch(() => ({}))) as { tagIds?: string[] };
    const tags = await setCustomerTags(ctx.tenant.id, params.id, body.tagIds ?? []);
    if (!tags) return jsonError("not_found", "Customer not found in this business", 404);
    await audit(ctx, "customer.tags_set", "customer", params.id, { tags: tags.map((t) => t.name) });
    return jsonOk({ tags });
  }, { name: "customer-tags" })(req);
}

export const dynamic = "force-dynamic";
