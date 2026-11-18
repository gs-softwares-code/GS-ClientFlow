import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import {
  updateBranding, updateModules, updateChannelConfig, updateRegistrationFields,
  updateRetention, updateLoyaltyRules, updateAutomationConfig,
} from "@/server/services/whitelabel";
import { readSettings } from "@/server/settings";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    return jsonOk({
      tenant: {
        id: ctx.tenant.id, slug: ctx.tenant.slug, name: ctx.tenant.name,
        businessCategory: ctx.tenant.businessCategory, brandColor: ctx.tenant.brandColor,
        logoText: ctx.tenant.logoText, plan: ctx.tenant.plan,
        customDomain: ctx.tenant.customDomain, domainVerifiedAt: ctx.tenant.domainVerifiedAt,
        domainVerifyToken: ctx.tenant.domainVerifyToken,
      },
      settings: ctx.settings,
    });
  }, { name: "tenant-get" })(_req);
}

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { section?: string; patch?: Record<string, unknown> };
    const patch = body.patch ?? {};
    if (!body.section) return jsonError("bad_request", "section is required", 400);

    switch (body.section) {
      case "branding": {
        const tenant = await updateBranding(ctx, patch as Parameters<typeof updateBranding>[1]);
        return jsonOk({ tenant, settings: readSettings(tenant) });
      }
      case "modules": {
        const tenant = await updateModules(ctx, patch as Record<string, boolean>);
        return jsonOk({ settings: readSettings(tenant!) });
      }
      case "channels": {
        const channel = String(patch.channel ?? "");
        const tenant = await updateChannelConfig(ctx, channel, patch as { enabled: boolean; fromName?: string; fromEmail?: string });
        if (!tenant) return jsonError("bad_request", "Unknown channel", 400);
        return jsonOk({ settings: readSettings(tenant) });
      }
      case "registrationFields": {
        const tenant = await updateRegistrationFields(ctx, (patch.fields as { key: string; label: string; required: boolean; active: boolean }[]) ?? []);
        return jsonOk({ settings: readSettings(tenant!) });
      }
      case "retention": {
        const tenant = await updateRetention(ctx, patch as Parameters<typeof updateRetention>[1]);
        return jsonOk({ settings: readSettings(tenant!) });
      }
      case "loyaltyRules": {
        const tenant = await updateLoyaltyRules(ctx, patch as Record<string, number | boolean>);
        return jsonOk({ settings: readSettings(tenant!) });
      }
      case "automation": {
        const tenant = await updateAutomationConfig(ctx, patch as Parameters<typeof updateAutomationConfig>[1]);
        return jsonOk({ settings: readSettings(tenant!) });
      }
      default:
        return jsonError("bad_request", "Unknown section", 400);
    }
  }, { name: "tenant-update" })(req);
}

export const dynamic = "force-dynamic";
