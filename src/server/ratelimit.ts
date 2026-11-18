import { track429 } from "@/server/ops-state";

/**
 * In-memory token bucket (per-instance local cache — the mandated stack for
 * this sandbox). Buckets are tenant+route scoped so one noisy tenant cannot
 * starve another. In production this maps to a durable edge KV/DO limiter.
 */
type Bucket = { tokens: number; last: number };

const g = globalThis as unknown as { __gscfBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__gscfBuckets ??= new Map());

export type RateLimitResult = { ok: boolean; retryAfterMs: number; remaining: number };

export function rateLimit(key: string, capacity: number, refillPerSecond: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, last: now };

  const elapsedSec = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSecond);
  bucket.last = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { ok: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
  }

  buckets.set(key, bucket);
  const retryAfterMs = Math.ceil(((1 - bucket.tokens) / refillPerSecond) * 1000);
  track429(key);
  return { ok: false, retryAfterMs, remaining: 0 };
}

// Opportunistic cleanup so the map cannot grow unbounded.
export function pruneBuckets(olderThanMs = 10 * 60_000): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.last > olderThanMs) buckets.delete(key);
  }
}
