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
 * In production this table is drained by a Cloudflare Queue consumer; in
 * this sandbox the in-process worker (see worker.ts) plays that role with
 * identical semantics: claim -> idempotent handler -> retry/backoff -> DLQ.
 */

type DbOrTx = Prisma.TransactionClient | typeof db;

export type OutboxInput = {
  tenantId: string;
  type: EventType;
  payload: Record<string, unknown>;
  /** Stable idempotency key — publishing twice with the same key is a no-op. */
  dedupeKey?: string;
};

export async function publish(tx: DbOrTx, input: OutboxInput) {
  if (input.dedupeKey) {
    const existing = await tx.outboxEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return existing;
  }
  return tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payload: JSON.stringify(input.payload),
      dedupeKey: input.dedupeKey ?? null,
    },
  });
}

export async function publishDb(input: OutboxInput) {
  return publish(db, input);
}

export { logEvent };
