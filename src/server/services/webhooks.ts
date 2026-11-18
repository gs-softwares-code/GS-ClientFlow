import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes, type EventType } from "@/server/events/contracts";
import { toJson } from "@/server/lib/json";
import { safeOutboundFetch } from "@/server/lib/ssrf";
import crypto from "crypto";

/**
 * Enterprise Webhook Dispatcher
 * Allows enterprise tenants to subscribe external endpoints (HubSpot, Salesforce, Zapier, Webhooks)
 * to any of the 10 core event streams with HMAC-SHA256 signature verification and SSRF protection.
 */

export type WebhookConfig = {
  id: string;
  url: string;
  secret: string;
  subscribedEvents: EventType[];
  active: boolean;
};

/**
 * Generate HMAC-SHA256 signature for webhook payload verification
 */
export function signWebhookPayload(payload: string, secret: string, timestamp?: string): string {
  const content = timestamp ? `${timestamp}.${payload}` : payload;
  return crypto.createHmac("sha256", secret).update(content, "utf8").digest("hex");
}

/**
 * Dispatch webhook to external URL with SSRF protection, timeout, and signed headers
 */
export async function dispatchWebhook(
  tenantId: string,
  event: {
    id: string;
    type: EventType;
    payload: unknown;
    timestamp: string;
  },
  webhook: WebhookConfig
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  if (!webhook.active || !webhook.subscribedEvents.includes(event.type)) {
    return { success: false, error: "Event not subscribed or webhook inactive" };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    eventId: event.id,
    type: event.type,
    tenantId,
    timestamp: event.timestamp,
    data: event.payload,
  });

  const signature = signWebhookPayload(body, webhook.secret, timestamp);
  const legacySignature = signWebhookPayload(body, webhook.secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s SLA timeout

    const res = await safeOutboundFetch(
      webhook.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GS-Signature-256": `t=${timestamp},v1=${signature}`,
          "X-GS-Timestamp": timestamp,
          "X-GS-Signature": legacySignature,
          "X-GS-Event": event.type,
          "X-GS-Delivery": crypto.randomUUID(),
          "User-Agent": "GS-ClientFlow-Webhook-Agent/1.0",
        },
        body,
        signal: controller.signal,
      },
      { allowHttpInDev: true }
    );
    clearTimeout(timeout);

    return {
      success: res.ok,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network or SSRF error",
    };
  }
}
