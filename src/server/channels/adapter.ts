import type { Tenant } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJson } from "@/server/lib/json";
import { stableHash } from "@/server/lib/ids";
import { readSettings, type TenantSettings } from "@/server/settings";
import { meterUsage } from "@/server/usage";
import { logEvent } from "@/server/logs";
import { safeFetch } from "@/server/lib/ssrf";

/**
 * Channel delivery adapter.
 *
 * Sandbox provider semantics (deterministic by stable hash of the idempotency
 * key — so retries and dead-letters are reproducible, not random noise):
 *   hash % 97 === 0            -> permanent failure (hard bounce) => DLQ
 *   hash % 17 === 0, 1st try   -> transient failure (provider 503), succeeds on retry
 *   otherwise                  -> delivered (about 43% read)
 *
 * In production this adapter is the email/SMS/WhatsApp provider client and
 * the outbox/queue machinery stays identical.
 */

export type Consents = { marketing?: boolean; email?: boolean; sms?: boolean; whatsapp?: boolean };

export class TransientDeliveryError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TransientDeliveryError";
  }
}
export class PermanentDeliveryError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PermanentDeliveryError";
  }
}

export type SendParams = {
  tenant: Tenant;
  customer: { id: string; name: string; email: string; phone: string | null; consents: string };
  channel: "email" | "sms" | "whatsapp";
  kind: "campaign" | "workflow" | "transactional";
  subject?: string;
  body: string;
  campaignId?: string;
  idempotencyKey?: string;
  requireConsent?: boolean;
};

export type SendResult = {
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "skipped";
  messageId: string;
  detail: string;
};

export async function sendChannelMessage(params: SendParams): Promise<SendResult> {
  const settings: TenantSettings = readSettings(params.tenant);
  const channelCfg = settings.channels[params.channel];

  const finish = async (
    status: SendResult["status"],
    detail: string,
    extra?: { sentAt?: Date | null; deliveredAt?: Date | null; readAt?: Date | null; lastError?: string | null }
  ) => {
    const msg = await db.message.create({
      data: {
        tenantId: params.tenant.id,
        campaignId: params.campaignId ?? null,
        customerId: params.customer.id,
        channel: params.channel,
        kind: params.kind,
        subject: params.subject ?? null,
        body: params.body,
        status,
        idempotencyKey: params.idempotencyKey ?? null,
        ...extra,
      },
    });
    await meterUsage(params.tenant.id, "messages");
    return { status, messageId: msg.id, detail };
  };

  if (!channelCfg?.enabled) {
    return finish("skipped", `Channel "${params.channel}" is disabled for this business`);
  }

  const consents = parseJson<Consents>(params.customer.consents, {});
  if (params.requireConsent !== false) {
    const hasConsent = params.channel === "email" ? consents.email !== false : consents[params.channel] === true;
    if (!hasConsent) {
      return finish("skipped", "Customer has not opted in for this channel");
    }
  }

  // Idempotent send: a retried handler must not double-send.
  if (params.idempotencyKey) {
    const existing = await db.message.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing && (existing.status === "delivered" || existing.status === "read" || existing.status === "sent")) {
      return { status: existing.status as SendResult["status"], messageId: existing.id, detail: "Already delivered (idempotent)" };
    }
    if (existing) {
      // previously failed — retry delivery with fresh attempt count logic below
      const outcome = await attempt(existing.id, existing.attempts, existing.idempotencyKey ?? existing.id, params);
      return outcome;
    }
  }

  const created = await db.message.create({
    data: {
      tenantId: params.tenant.id,
      campaignId: params.campaignId ?? null,
      customerId: params.customer.id,
      channel: params.channel,
      kind: params.kind,
      subject: params.subject ?? null,
      body: params.body,
      status: "queued",
      idempotencyKey: params.idempotencyKey ?? null,
    },
  });
  await meterUsage(params.tenant.id, "messages");
  return attempt(created.id, 0, params.idempotencyKey ?? created.id, params);
}

async function attempt(
  messageId: string,
  attemptsSoFar: number,
  hashKey: string,
  params: SendParams
): Promise<SendResult> {
  // If an external webhook/provider URL is specified, route through SSRF validator
  const outboundUrl = process.env.CHANNEL_WEBHOOK_URL;
  if (outboundUrl) {
    try {
      await safeFetch(outboundUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          channel: params.channel,
          to: params.customer.email || params.customer.phone,
          subject: params.subject,
          body: params.body,
        }),
      }, { allowHttpInDev: true });
    } catch (err) {
      await logEvent("warn", "channel", `Outbound provider SSRF or network error: ${(err as Error).message}`, { messageId }, params.tenant.id);
    }
  }

  const h = stableHash(hashKey);
  const now = new Date();

  if (h % 97 === 0) {
    await db.message.update({
      where: { id: messageId },
      data: { status: "failed", attempts: attemptsSoFar + 1, lastError: "Sandbox provider: hard bounce (permanent)" },
    });
    await logEvent("warn", "channel", `Permanent delivery failure (${params.channel})`, { messageId }, params.tenant.id);
    throw new PermanentDeliveryError("Sandbox provider: hard bounce");
  }

  if (h % 17 === 0 && attemptsSoFar === 0) {
    await db.message.update({
      where: { id: messageId },
      data: { status: "failed", attempts: 1, lastError: "Sandbox provider: 503 transient (will retry)" },
    });
    await logEvent("warn", "channel", `Transient delivery failure (${params.channel})`, { messageId }, params.tenant.id);
    throw new TransientDeliveryError("Sandbox provider: 503 transient");
  }

  const read = h % 7 < 3;
  await db.message.update({
    where: { id: messageId },
    data: {
      status: read ? "read" : "delivered",
      attempts: attemptsSoFar + 1,
      sentAt: now,
      deliveredAt: now,
      readAt: read ? now : null,
      lastError: null,
    },
  });
  return { status: read ? "read" : "delivered", messageId, detail: "Delivered via sandbox provider" };
}

export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}
