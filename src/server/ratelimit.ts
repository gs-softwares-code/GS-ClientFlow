import { track429 } from "@/server/ops-state";
import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/next";
import type { NextRequest } from "next/server";

/**
 * Enterprise Multi-Layer Perimeter Defense & Rate Limiting
 *
 * Layer 1: Arcjet Shield WAF & Bot Mitigation (Cloud / Production)
 * Layer 2: Tenant-scoped in-memory token bucket (Zero-latency fallback & Sandbox)
 */

type Bucket = { tokens: number; last: number };

const g = globalThis as unknown as { __gscfBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__gscfBuckets ??= new Map());

export type RateLimitResult = { ok: boolean; retryAfterMs: number; remaining: number; reason?: string };

// Initialize Arcjet client if ARCJET_KEY environment variable is configured
const aj = process.env.ARCJET_KEY
  ? arcjet({
      key: process.env.ARCJET_KEY,
      characteristics: ["ip.src"],
      rules: [
        // Shield protects against common Web Application attacks (SQLi, XSS, Path Traversal)
        shield({ mode: "LIVE" }),
        // Detect and block automated malicious bots while allowing search engine crawlers
        detectBot({
          mode: "LIVE",
          allow: ["CATEGORY:SEARCH_ENGINE"],
        }),
        // Sliding window rate limit
        slidingWindow({
          mode: "LIVE",
          interval: "1m",
          max: 120,
        }),
      ],
    })
  : null;

/**
 * Perform perimeter security evaluation using Arcjet Shield WAF
 */
export async function arcjetEvaluate(
  req: NextRequest
): Promise<{ allowed: boolean; reason?: string }> {
  if (!aj) return { allowed: true };

  try {
    const decision = await aj.protect(req);
    if (decision.isDenied()) {
      if (decision.reason.isShield()) {
        return { allowed: false, reason: "Request blocked by WAF Shield: suspicious payload detected" };
      }
      if (decision.reason.isBot()) {
        return { allowed: false, reason: "Request blocked: malicious or untrusted bot detected" };
      }
      if (decision.reason.isRateLimit()) {
        return { allowed: false, reason: "Rate limit exceeded" };
      }
      return { allowed: false, reason: "Access denied by perimeter security policy" };
    }
    return { allowed: true };
  } catch (err) {
    // Fail-open on network timeout to prevent Arcjet API outages from bringing down the service
    console.warn("[Arcjet Protection Warning]: Falling back to local rate limiter", err);
    return { allowed: true };
  }
}

/**
 * In-memory tenant+route scoped token bucket
 */
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
  return { ok: false, retryAfterMs, remaining: 0, reason: "Too many requests" };
}

// Opportunistic cleanup so the map cannot grow unbounded
export function pruneBuckets(olderThanMs = 10 * 60_000): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.last > olderThanMs) buckets.delete(key);
  }
}
