import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";
import { configureDomain, verifyDomain } from "@/server/services/whitelabel";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { action?: string; domain?: string };
    try {
      if (body.action === "configure") {
        const result = await configureDomain(ctx, body.domain ?? "");
        return jsonOk(result);
      }
      if (body.action === "verify") {
        const result = await verifyDomain(ctx);
        return jsonOk(result);
      }
      return jsonError("bad_request", "Unknown action (configure | verify)", 400);
    } catch (err) {
      const e = err as Error & { code?: string };
      return jsonError(e.code ?? "bad_request", e.message, 400);
    }
  }, { name: "tenant-domain" })(req);
}

export const dynamic = "force-dynamic";
