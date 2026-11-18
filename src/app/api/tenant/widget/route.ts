import { NextRequest } from "next/server";
import { withRoute, jsonOk } from "@/server/tenancy/guard";
import { widgetSnippet } from "@/server/services/whitelabel";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    return jsonOk({
      snippet: widgetSnippet({ slug: ctx.tenant.slug, name: ctx.tenant.name, brandColor: ctx.tenant.brandColor }),
      embedUrl: `https://${ctx.tenant.slug}.gsclientflow.app`,
      widgetPreview: {
        title: "Book in 30 seconds",
        description: `Check availability at ${ctx.tenant.name} and confirm instantly.`,
        cta: "Find a slot",
      },
    });
  }, { name: "tenant-widget" })(_req);
}

export const dynamic = "force-dynamic";
