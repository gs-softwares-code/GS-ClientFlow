import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logEvent } from "@/server/logs";
import type { EventType } from "@/server/events/contracts";

/**
 * Transactional outbox.
 *
 * `publish(tx, ...)` accepts the caller's Prisma transaction client so the
 * event insert is ATOMIC with the business write (the defining property of
 * the transactional outbox pattern). `publish` without a tx is for cases
 * where the source operation itself is a single atomic write.
 *
 * Every event payload is cryptographically bound to its tenantId and type
 * via an HMAC-SHA256 signature and correlation ID to guarantee integrity.
 */

type DbOrTx = Prisma.TransactionClient | typeof db;

export type OutboxInput = {
  tenantId: string;
  type: EventType;
  payload: Record<string, unknown>;
  /** Stable idempotency key — publishing twice with the same key is a no-op. */
  dedupeKey?: string;
  correlationId?: string;
};

export function signEventPayload(
  tenantId: string,
  type: string,
  payloadStr: string,
  correlationId: string
): string {
  const secret = process.env.OUTBOX_HMAC_SECRET || "gsclientflow_outbox_secure_hmac_secret_2026";
  return crypto
    .createHmac("sha256", secret)
    .update(`${tenantId}:${type}:${payloadStr}:${correlationId}`)
    .digest("hex");
}

export function verifyEventPayload(
  tenantId: string,
  type: string,
  payloadStr: string,
  correlationId: string,
  signature: string
): boolean {
  const expected = signEventPayload(tenantId, type, payloadStr, correlationId);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function publish(tx: DbOrTx, input: OutboxInput) {
  if (input.dedupeKey) {
    const existing = await tx.outboxEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return existing;
  }

  const correlationId = input.correlationId || crypto.randomUUID();
  const rawPayload = JSON.stringify(input.payload);
  const signature = signEventPayload(input.tenantId, input.type, rawPayload, correlationId);

  const signedPayload = JSON.stringify({
    ...input.payload,
    _meta: {
      correlationId,
      signature,
      signedAt: Date.now(),
      tenantId: input.tenantId,
    },
  });

  return tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payload: signedPayload,
      dedupeKey: input.dedupeKey ?? null,
    },
  });
}

export async function publishDb(input: OutboxInput) {
  return publish(db, input);
}

export { logEvent };
