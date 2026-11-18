import { NextRequest, NextResponse } from "next/server";
import { getSessionCtx, listTenants } from "@/server/tenancy/session";
import { usageSnapshot } from "@/server/usage";
import { EVENT_CATALOG } from "@/server/events/contracts";

export async function GET(_req: NextRequest) {
  const ctx = await getSessionCtx();
  if (!ctx) {
    const tenants = await listTenants();
    return NextResponse.json({ user: null, tenants, eventCatalog: EVENT_CATALOG });
  }
  const usage = await usageSnapshot(ctx.tenant.id, ctx.tenant.plan).catch(() => null);
  return NextResponse.json({
    user: {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.user.role,
      isPlatformAdmin: ctx.user.isPlatformAdmin,
    },
    tenant: {
      id: ctx.tenant.id,
      slug: ctx.tenant.slug,
      name: ctx.tenant.name,
      businessCategory: ctx.tenant.businessCategory,
      brandColor: ctx.tenant.brandColor,
      logoText: ctx.tenant.logoText,
      plan: ctx.tenant.plan,
      customDomain: ctx.tenant.customDomain,
      domainVerifiedAt: ctx.tenant.domainVerifiedAt,
      settings: ctx.settings,
    },
    tenants: ctx.user.isPlatformAdmin ? await listTenants() : [],
    usage,
    eventCatalog: EVENT_CATALOG,
  });
}

export const dynamic = "force-dynamic";
