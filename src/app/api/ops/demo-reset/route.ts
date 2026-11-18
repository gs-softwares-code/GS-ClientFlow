import { NextRequest } from "next/server";
import { reseed } from "@/server/seed";
import { withRoute, jsonOk, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx) => {
    const result = await reseed();
    await audit(ctx, "ops.demo_reset", "tenant", ctx.tenant.id, result);
    return jsonOk({
      message: `Demo dataset regenerated (${result.tenants} tenants, ${result.customers} customers). Sessions cleared — sign in again.`,
      ...result,
    });
  }, { name: "ops-demo-reset", limitPerMinute: 3 })(req);
}

export const dynamic = "force-dynamic";
