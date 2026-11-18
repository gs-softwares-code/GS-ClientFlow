import { NextRequest } from "next/server";
import { executeCampaign } from "@/server/services/campaigns";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { campaignId?: string };
    if (!body.campaignId) return jsonError("bad_request", "campaignId is required", 400);
    const campaign = await executeCampaign(ctx.tenant.id, body.campaignId);
    if (!campaign) return jsonError("not_found", "Campaign not found", 404);
    await audit(ctx, "campaign.run_now", "campaign", body.campaignId);
    return jsonOk({ campaign });
  }, { name: "campaigns-run" })(req);
}

export const dynamic = "force-dynamic";
