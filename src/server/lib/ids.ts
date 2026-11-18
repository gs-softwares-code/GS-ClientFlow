import { randomBytes, randomUUID } from "crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomFrom(alphabet: string, len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Stable, short, cursor key for customers (cursor pagination). */
export function publicId(): string {
  return `c${Date.now().toString(36)}${randomFrom(ALPHABET, 6)}`;
}

/** Coupon code, e.g. AURORA-7K2M9Q */
export function couponCode(businessPrefix: string): string {
  const p = (businessPrefix || "GC").replace(/[^a-zA-Z]/g, "").slice(0, 6).toUpperCase() || "GC";
  return `${p}-${randomFrom("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}`;
}

/** Referral code derived from the customer name + random suffix. */
export function referralCode(name: string): string {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() || "GC";
  return `${initials}${randomFrom("0123456789", 4)}`;
}

export function uuid(): string {
  return randomUUID();
}

/** Deterministic 32-bit hash — used by the sandbox channel adapter to make
 * delivery outcomes stable (retry/DLQ demo is reproducible, not random noise). */
export function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}
