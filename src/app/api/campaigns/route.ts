import { NextRequest } from "next/server";
import { createCampaign, campaignStats, scheduleCampaign } from "@/server/services/campaigns";
import { listMessages } from "@/server/services/campaigns";
import { db } from "@/lib/db";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    if (url.searchParams.get("messages") !== null) {
      const messages = await listMessages(ctx.tenant.id, {
        campaignId: url.searchParams.get("campaignId"),
        customerId: url.searchParams.get("customerId"),
        status: url.searchParams.get("status"),
        limit: Number(url.searchParams.get("limit") ?? 50),
      });
      return jsonOk({ messages });
    }
    const campaigns = await campaignStats(ctx.tenant.id);
    return jsonOk({ campaigns });
  }, { name: "campaigns-list" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    if (!ctx.settings.modules.campaigns) {
      return jsonError("module_disabled", "Campaigns module is disabled for this business", 409);
    }
    const body = (await request.json().catch(() => ({}))) as {
      name?: string; channel?: string; template?: string; segmentId?: string | null; scheduledAt?: string | null;
    };
    if (!body.name?.trim() || !body.template?.trim()) {
      return jsonError("bad_request", "Campaign name and message template are required", 400);
    }
    const campaign = await createCampaign(ctx.tenant.id, {
      name: body.name,
      channel: body.channel ?? "email",
      template: body.template,
      segmentId: body.segmentId ?? null,
      scheduledAt: body.scheduledAt ?? null,
      draft: !body.scheduledAt,
    });
    if (!campaign) return jsonError("internal", "Campaign could not be created", 500);
    await audit(ctx, "campaign.created", "campaign", campaign.id, { name: campaign.name });
    return jsonOk({ campaign });
  }, { name: "campaigns-create" })(req);
}

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      campaignId?: string; action?: string; scheduledAt?: string; template?: string; name?: string; segmentId?: string | null;
    };
    if (!body.campaignId) return jsonError("bad_request", "campaignId is required", 400);
    const campaign = await db.campaign.findFirst({ where: { id: body.campaignId, tenantId: ctx.tenant.id } });
    if (!campaign) return jsonError("not_found", "Campaign not found", 404);

    if (body.action === "cancel") {
      const updated = await db.campaign.update({ where: { id: campaign.id }, data: { status: "cancelled" } });
      // cancel pending run actions
      const actions = await db.scheduledAction.findMany({ where: { tenantId: ctx.tenant.id, kind: "campaign_run", status: "pending" } });
      for (const a of actions) {
        try {
          if (JSON.parse(a.payload).campaignId === campaign.id) {
            await db.scheduledAction.update({ where: { id: a.id }, data: { status: "cancelled" } });
          }
        } catch { /* ignore */ }
      }
      await audit(ctx, "campaign.cancelled", "campaign", campaign.id);
      return jsonOk({ campaign: updated });
    }

    if (body.action === "reschedule" || body.action === "schedule") {
      if (!body.scheduledAt) return jsonError("bad_request", "scheduledAt is required", 400);
      const updated = await scheduleCampaign(ctx.tenant.id, campaign.id, body.scheduledAt);
      await audit(ctx, "campaign.scheduled", "campaign", campaign.id, { scheduledAt: body.scheduledAt });
      return jsonOk({ campaign: updated });
    }

    if (body.action === "update") {
      const updated = await db.campaign.update({
        where: { id: campaign.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.template ? { template: body.template } : {}),
          segmentId: body.segmentId !== undefined ? body.segmentId : undefined,
        },
      });
      await audit(ctx, "campaign.updated", "campaign", campaign.id);
      return jsonOk({ campaign: updated });
    }

    return jsonError("bad_request", "Unknown action", 400);
  }, { name: "campaigns-update" })(req);
}

export const dynamic = "force-dynamic";
