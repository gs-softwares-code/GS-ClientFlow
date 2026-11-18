import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { redeemPoints } from "@/server/services/loyalty";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const [accounts, txns, referrals, coupons] = await Promise.all([
      db.customer.findMany({
        where: { tenantId: ctx.tenant.id, pointsBalance: { gt: 0 } },
        orderBy: { pointsBalance: "desc" },
        take: 25,
        select: { id: true, name: true, email: true, pointsBalance: true, visitCount: true, totalSpendCents: true },
      }),
      db.rewardTransaction.findMany({
        where: { tenantId: ctx.tenant.id },
        orderBy: { createdAt: "desc" },
        take: 60,
        include: { customer: { select: { id: true, name: true } } },
      }),
      db.referralCode.findMany({
        where: { tenantId: ctx.tenant.id },
        orderBy: { usesCount: "desc" },
        take: 25,
        include: { customer: { select: { id: true, name: true } } },
      }),
      db.coupon.findMany({
        where: { tenantId: ctx.tenant.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { offer: { select: { title: true } }, customer: { select: { name: true } } },
      }),
    ]);
    return jsonOk({ accounts, transactions: txns, referrals, coupons, rules: ctx.settings.loyalty, enabled: ctx.settings.modules.loyalty });
  }, { name: "loyalty-list" })(_req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string; customerId?: string; points?: number; reason?: string;
    };
    if (body.action === "redeem") {
      if (!body.customerId || !body.points) return jsonError("bad_request", "customerId and points are required", 400);
      if (!ctx.settings.modules.loyalty) return jsonError("module_disabled", "Loyalty module is disabled", 409);
      try {
        const result = await redeemPoints(ctx.tenant.id, body.customerId, body.points, ctx.tenant.name);
        await audit(ctx, "loyalty.redeemed", "customer", body.customerId, { points: body.points, code: result.couponCode });
        return jsonOk({ ...result, message: `Voucher ${result.couponCode} issued` });
      } catch (err) {
        const e = err as Error & { code?: string };
        return jsonError(e.code ?? "bad_request", e.message, 400);
      }
    }

    if (body.action === "adjust") {
      if (!body.customerId || body.points === undefined) return jsonError("bad_request", "customerId and points (+/-) are required", 400);
      const customer = await db.customer.findFirst({ where: { id: body.customerId, tenantId: ctx.tenant.id } });
      if (!customer) return jsonError("not_found", "Customer not found", 404);
      const newBalance = customer.pointsBalance + body.points;
      if (newBalance < 0) return jsonError("insufficient_points", "Adjustment would take the balance below zero", 400);
      await db.$transaction(async (tx) => {
        const txn = await tx.rewardTransaction.create({
          data: {
            tenantId: ctx.tenant.id,
            customerId: body.customerId!,
            kind: "adjust",
            points: body.points!,
            reason: body.reason?.trim() || `Manual adjustment by ${ctx.user.name}`,
            balanceAfter: newBalance,
            idempotencyKey: `adjust:${body.customerId}:${Date.now()}`,
          },
        });
        await tx.customer.update({ where: { id: body.customerId! }, data: { pointsBalance: newBalance } });
        return txn;
      });
      await audit(ctx, "loyalty.adjusted", "customer", body.customerId, { points: body.points, newBalance });
      return jsonOk({ balance: newBalance, message: "Balance adjusted" });
    }

    return jsonError("bad_request", "Unknown action (redeem | adjust)", 400);
  }, { name: "loyalty-action" })(req);
}

export const dynamic = "force-dynamic";
