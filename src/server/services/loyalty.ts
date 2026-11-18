import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { couponCode } from "@/server/lib/ids";
import { readSettings, type TenantSettings } from "@/server/settings";

/**
 * Loyalty service — every point movement runs in a transaction guarded by a
 * UNIQUE idempotency key, so duplicate credits (double-fired events, retried
 * handlers, double-clicks) are impossible by construction.
 */

type Tx = Prisma.TransactionClient | typeof db;

export type CreditResult = {
  duplicate: boolean;
  balanceAfter: number;
  points: number;
  transactionId: string | null;
};

export async function creditPoints(
  tenantId: string,
  params: {
    customerId: string;
    kind: string;
    points: number;
    reason: string;
    idempotencyKey: string;
  },
  externalTx?: Tx
): Promise<CreditResult> {
  const run = async (tx: Tx): Promise<CreditResult> => {
    const existing = await tx.rewardTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) {
      return { duplicate: true, balanceAfter: existing.balanceAfter, points: existing.points, transactionId: existing.id };
    }
    const customer = await tx.customer.findFirst({ where: { id: params.customerId, tenantId } });
    if (!customer) throw Object.assign(new Error("Customer not found in this tenant"), { code: "not_found" });
    const newBalance = customer.pointsBalance + params.points;
    if (params.points < 0 && newBalance < 0) {
      throw Object.assign(new Error("Insufficient points balance"), { code: "insufficient_points" });
    }
    const txn = await tx.rewardTransaction.create({
      data: {
        tenantId,
        customerId: params.customerId,
        kind: params.kind,
        points: params.points,
        reason: params.reason,
        balanceAfter: newBalance,
        idempotencyKey: params.idempotencyKey,
      },
    });
    await tx.customer.update({ where: { id: params.customerId }, data: { pointsBalance: newBalance } });
    return { duplicate: false, balanceAfter: newBalance, points: params.points, transactionId: txn.id };
  };
  return externalTx ? run(externalTx) : db.$transaction(run);
}

export async function applyVisitEarnings(
  tenantId: string,
  customer: { id: string; name: string },
  visitId: string,
  amountCents: number,
  settings: TenantSettings,
  tx?: Tx
): Promise<CreditResult | null> {
  if (!settings.loyalty.enabled) return null;
  const points =
    settings.loyalty.pointsPerVisit + Math.floor(amountCents / 100) * settings.loyalty.pointsPerHundredRupees;
  if (points <= 0) return null;
  return creditPoints(
    tenantId,
    {
      customerId: customer.id,
      kind: "earn_visit",
      points,
      reason: "Visit completed",
      idempotencyKey: `visit:${visitId}`,
    },
    tx
  );
}

export async function applyFeedbackEarnings(
  tenantId: string,
  feedbackId: string,
  customerId: string,
  settings: TenantSettings
): Promise<CreditResult | null> {
  if (!settings.loyalty.enabled) return null;
  if (settings.loyalty.pointsPerFeedback <= 0) return null;
  return creditPoints(tenantId, {
    customerId,
    kind: "earn_feedback",
    points: settings.loyalty.pointsPerFeedback,
    reason: "Feedback submitted",
    idempotencyKey: `feedback:${feedbackId}`,
  });
}

export async function applyReferralRewards(
  tenantId: string,
  referrerCustomerId: string,
  newCustomerId: string,
  settings: TenantSettings
): Promise<{ referrer: CreditResult | null; newcomer: CreditResult | null }> {
  if (!settings.loyalty.enabled) return { referrer: null, newcomer: null };
  const referrer = await creditPoints(tenantId, {
    customerId: referrerCustomerId,
    kind: "earn_referral",
    points: settings.loyalty.pointsPerReferral,
    reason: "Referral signup",
    idempotencyKey: `referral:${newCustomerId}`,
  });
  const newcomer = await creditPoints(tenantId, {
    customerId: newCustomerId,
    kind: "bonus",
    points: settings.loyalty.referralBonus,
    reason: "Welcome referral bonus",
    idempotencyKey: `referralwelcome:${newCustomerId}`,
  });
  return { referrer, newcomer };
}

export async function redeemPoints(
  tenantId: string,
  customerId: string,
  points: number,
  businessPrefix: string
): Promise<{ couponCode: string; balanceAfter: number }> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Tenant not found");
  const settings = readSettings(tenant);
  if (points < settings.loyalty.redemptionMinimum) {
    throw Object.assign(
      new Error(`Minimum redemption is ${settings.loyalty.redemptionMinimum} points`),
      { code: "below_minimum" }
    );
  }
  return db.$transaction(async (tx) => {
    const debit = await creditPoints(
      tenantId,
      { customerId, kind: "redeem", points: -points, reason: "Points redeemed for voucher", idempotencyKey: `redeem:${customerId}:${Date.now()}` },
      tx
    );
    const code = couponCode(tenant.name);
    await tx.coupon.create({
      data: {
        tenantId,
        customerId,
        code,
        status: "active",
        pointsCost: points,
        expiresAt: new Date(Date.now() + 90 * 86400_000),
      },
    });
    return { couponCode: code, balanceAfter: debit.balanceAfter };
  });
}

export async function ensureReferralCode(tenantId: string, customerId: string, name: string): Promise<string> {
  const existing = await db.referralCode.findFirst({ where: { tenantId, customerId } });
  if (existing) return existing.code;
  let code = couponCodeForName(name);
  const clash = await db.referralCode.findFirst({ where: { tenantId, code } });
  if (clash) code = `${code}${Math.floor(Math.random() * 90) + 10}`;
  await db.referralCode.create({ data: { tenantId, customerId, code } });
  return code;
}

function couponCodeForName(name: string): string {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() || "GC";
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  return `${initials}${digits}`;
}
