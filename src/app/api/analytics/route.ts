import { NextRequest } from "next/server";
import { overview, customerIntelligence, feedbackTrends, appointmentPerformance, loyaltyStats } from "@/server/services/analytics";
import { campaignStats } from "@/server/services/campaigns";
import { withRoute, jsonOk, jsonError } from "@/server/tenancy/guard";

function parseRange(url: URL): { from: Date; to: Date } {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 90 * 86400_000);
  return { from, to: Number.isNaN(to.getTime()) ? new Date() : to };
}

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const report = url.searchParams.get("report") ?? "overview";
    const range = parseRange(url);
    if (Number.isNaN(range.from.getTime())) return jsonError("bad_request", "Invalid from date", 400);

    switch (report) {
      case "overview":
        return jsonOk(await overview(ctx.tenant.id, range));
      case "customers":
        return jsonOk(await customerIntelligence(ctx.tenant.id, range));
      case "feedback":
        return jsonOk(await feedbackTrends(ctx.tenant.id, range));
      case "appointments":
        return jsonOk(await appointmentPerformance(ctx.tenant.id, range));
      case "loyalty":
        return jsonOk(await loyaltyStats(ctx.tenant.id, range));
      case "campaigns":
        return jsonOk({ campaigns: await campaignStats(ctx.tenant.id) });
      case "all": {
        const [o, c, f, a, l, camp] = await Promise.all([
          overview(ctx.tenant.id, range),
          customerIntelligence(ctx.tenant.id, range),
          feedbackTrends(ctx.tenant.id, range),
          appointmentPerformance(ctx.tenant.id, range),
          loyaltyStats(ctx.tenant.id, range),
          campaignStats(ctx.tenant.id),
        ]);
        return jsonOk({ overview: o, customers: c, feedback: f, appointments: a, loyalty: l, campaigns: camp });
      }
      default:
        return jsonError("bad_request", "Unknown report", 400);
    }
  }, { name: "analytics", limitPerMinute: 120 })(req);
}

export const dynamic = "force-dynamic";
