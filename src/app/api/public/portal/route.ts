import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withPublicRoute, jsonOk } from "@/server/tenancy/guard";
import { readSettings } from "@/server/settings";

/** Customer-facing branded portal data: brand, services, loyalty wallet, history. */
export async function GET(req: NextRequest) {
  return withPublicRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");

    const services = ctx.settings.modules.appointments
      ? await db.service.findMany({ where: { tenantId: ctx.tenant.id, active: true }, orderBy: { name: "asc" } })
      : [];

    const wallet = email
      ? await db.customer.findFirst({
          where: { tenantId: ctx.tenant.id, email: email.trim().toLowerCase() },
          include: {
            coupons: { where: { status: "active" }, orderBy: { createdAt: "desc" }, take: 10, include: { offer: { select: { title: true } } } },
            referralCodes: { take: 1 },
          },
        })
      : null;

    const walletPayload = wallet
      ? {
          name: wallet.name,
          email: wallet.email,
          pointsBalance: wallet.pointsBalance,
          visitCount: wallet.visitCount,
          lifetimeSpendCents: wallet.totalSpendCents,
          tier: wallet.pointsBalance >= 1000 ? "Gold" : wallet.pointsBalance >= 400 ? "Silver" : "Member",
          coupons: wallet.coupons.map((c) => ({ code: c.code, title: c.offer?.title ?? "Voucher", expiresAt: c.expiresAt })),
          referralCode: wallet.referralCodes[0]?.code ?? null,
        }
      : null;

    return jsonOk({
      brand: {
        name: ctx.tenant.name,
        slug: ctx.tenant.slug,
        color: ctx.tenant.brandColor,
        logoText: ctx.tenant.logoText,
        businessCategory: ctx.tenant.businessCategory,
      },
      modules: ctx.settings.modules,
      registrationFields: ctx.settings.registrationFields.filter((f) => f.active),
      loyaltyEnabled: ctx.settings.modules.loyalty && ctx.settings.loyalty.enabled,
      services,
      wallet: walletPayload,
    });
  }, { name: "public-portal", limitPerMinute: 30 })(req);
}

export const dynamic = "force-dynamic";
