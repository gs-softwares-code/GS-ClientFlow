import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { resolveAudienceIds } from "@/server/services/segments";
import { sendChannelMessage } from "@/server/channels/adapter";
import { readSettings } from "@/server/settings";
import { logEvent } from "@/server/logs";

/** Campaign service — scheduling, event-driven execution, execution logs. */

export async function createCampaign(
  tenantId: string,
  input: { name: string; channel: string; template: string; segmentId?: string | null; scheduledAt?: string | null; draft?: boolean }
) {
  const campaign = await db.campaign.create({
    data: {
      tenantId,
      name: input.name.trim(),
      channel: input.channel,
      template: input.template,
      segmentId: input.segmentId ?? null,
      status: "draft",
    },
  });
  if (input.scheduledAt && !input.draft) {
    return scheduleCampaign(tenantId, campaign.id, input.scheduledAt);
  }
  return campaign;
}

export async function scheduleCampaign(tenantId: string, campaignId: string, scheduledAt: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) return null;
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw Object.assign(new Error("Invalid schedule time"), { code: "invalid_time" });

  return db.$transaction(async (tx) => {
    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "scheduled", scheduledAt: when },
    });
    await publish(tx, {
      tenantId,
      type: EventTypes.CampaignScheduled,
      payload: { campaignId, scheduledAtMs: when.getTime() },
      dedupeKey: `campsched:${campaignId}`,
    });
    return updated;
  });
}

export async function executeCampaign(tenantId: string, campaignId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!tenant || !campaign) return null;
  if (campaign.status === "running" || campaign.status === "completed") return campaign;

  await db.campaign.update({ where: { id: campaignId }, data: { status: "running" } });

  const settings = readSettings(tenant);
  const audienceIds = await resolveAudienceIds(tenantId, { segmentId: campaign.segmentId });
  const customers = await db.customer.findMany({
    where: { tenantId, id: { in: audienceIds } },
    select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true },
  });

  let sent = 0, delivered = 0, failed = 0, skipped = 0;
  for (const customer of customers) {
    try {
      const result = await sendChannelMessage({
        tenant,
        customer,
        channel: campaign.channel as "email" | "sms" | "whatsapp",
        kind: "campaign",
        subject: campaign.name,
        body: campaign.template
          .replace(/\{name\}/g, customer.name.split(" ")[0])
          .replace(/\{business\}/g, tenant.name)
          .replace(/\{points\}/g, String(customer.pointsBalance)),
        campaignId: campaign.id,
        idempotencyKey: `camp:${campaign.id}:${customer.id}`,
        requireConsent: true,
      });
      if (result.status === "skipped") skipped += 1;
      else if (result.status === "failed") failed += 1;
      else {
        sent += 1;
        delivered += 1;
      }
    } catch (err) {
      // Transient/permanent provider failure thrown by the adapter: the
      // campaign row records the attempt; the message row tracks retries.
      failed += 1;
      await logEvent("error", "campaign", `Send failed for ${customer.name}: ${err instanceof Error ? err.message : String(err)}`, { campaignId }, tenantId);
    }
  }

  const completed = await db.campaign.update({
    where: { id: campaignId },
    data: { status: "completed", completedAt: new Date() },
  });

  await publish(db, {
    tenantId,
    type: EventTypes.CampaignCompleted,
    payload: { campaignId, sent, delivered, failed, skipped },
    dedupeKey: `campdone:${campaignId}`,
  });
  void settings;
  return completed;
}

export async function campaignStats(tenantId: string) {
  const segments = await db.segment.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const segmentName = new Map(segments.map((s) => [s.id, s.name]));
  const campaigns = await db.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      messages: { select: { status: true } },
    },
  });
  return campaigns.map((c) => {
    const m = c.messages;
    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      status: c.status,
      scheduledAt: c.scheduledAt,
      completedAt: c.completedAt,
      template: c.template,
      segmentName: c.segmentId ? segmentName.get(c.segmentId) ?? null : null,
      total: m.length,
      delivered: m.filter((x) => x.status === "delivered" || x.status === "read").length,
      read: m.filter((x) => x.status === "read").length,
      failed: m.filter((x) => x.status === "failed").length,
      skipped: m.filter((x) => x.status === "skipped").length,
    };
  });
}

export async function listMessages(tenantId: string, opts: { campaignId?: string | null; customerId?: string | null; status?: string | null; limit?: number }) {
  const where: Record<string, unknown> = { tenantId };
  if (opts.campaignId) where.campaignId = opts.campaignId;
  if (opts.customerId) where.customerId = opts.customerId;
  if (opts.status) where.status = opts.status;
  return db.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    include: { customer: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } },
  });
}
