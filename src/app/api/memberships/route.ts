import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import {
  createOrUpdateMembership,
  listMemberships,
  generateGymDailyDigest,
} from "@/server/services/memberships";
import { z } from "zod";

const CreateMembershipSchema = z.object({
  action: z.enum(["create", "daily_summary"]).optional().default("create"),
  customerId: z.string().optional(),
  planName: z.string().optional(),
  priceAmount: z.number().optional().default(0),
  startDate: z.string().optional(),
  expiryDate: z.string().optional(),
  paymentStatus: z.enum(["PAID", "PENDING", "OVERDUE"]).optional().default("PENDING"),
});

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const paymentStatus = url.searchParams.get("paymentStatus") ?? undefined;
    const customerId = url.searchParams.get("customerId") ?? undefined;

    const items = await listMemberships(ctx.tenant.id, { status, paymentStatus, customerId });
    return jsonOk({
      memberships: items,
      totalCount: items.length,
    });
  }, { name: "memberships-get" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const raw = await request.json().catch(() => ({}));
    const parsed = CreateMembershipSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError("bad_request", parsed.error.issues?.[0]?.message ?? "Invalid input", 400);
    }

    if (parsed.data.action === "daily_summary") {
      const summary = await generateGymDailyDigest(ctx.tenant.id);
      await audit(ctx, "gym.daily_summary_triggered", "tenant", ctx.tenant.id, summary);
      return jsonOk({ success: true, digest: summary });
    }

    const { customerId, planName, priceAmount, startDate, expiryDate, paymentStatus } = parsed.data;
    if (!customerId || !planName || !expiryDate) {
      return jsonError("bad_request", "customerId, planName, and expiryDate are required", 400);
    }

    const membership = await createOrUpdateMembership(ctx.tenant.id, {
      customerId,
      planName,
      priceAmount,
      startDate,
      expiryDate,
      paymentStatus,
    });

    await audit(ctx, "membership.created", "membership", membership.id, {
      planName,
      priceAmount,
      expiryDate,
    });

    return jsonOk({
      success: true,
      membership,
    });
  }, { name: "memberships-post", limitPerMinute: 30 })(req);
}

export const dynamic = "force-dynamic";
