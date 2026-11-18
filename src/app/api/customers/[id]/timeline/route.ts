import { NextRequest } from "next/server";
import { customerTimeline } from "@/server/services/customers";
import { withRoute, jsonOk } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, _request, params) => {
    const timeline = await customerTimeline(ctx.tenant.id, params.id);
    return jsonOk({ timeline });
  }, { name: "customer-timeline" })(req);
}

export const dynamic = "force-dynamic";
