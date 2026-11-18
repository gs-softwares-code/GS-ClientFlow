import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { readSettings } from "@/server/settings";
import { safeFetch } from "@/server/lib/ssrf";
import { logEvent } from "@/server/logs";

export type MembershipInput = {
  customerId: string;
  planName: string;
  priceAmount: number;
  startDate?: string;
  expiryDate: string;
  paymentStatus?: "PAID" | "PENDING" | "OVERDUE";
};

/**
 * Gym membership service: manages subscription life-cycle, payment tracking,
 * and automated daily executive summaries.
 */
export async function createOrUpdateMembership(tenantId: string, input: MembershipInput) {
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, tenantId },
  });
  if (!customer) throw new Error("Customer not found in this business");

  const start = input.startDate ? new Date(input.startDate) : new Date();
  const expiry = new Date(input.expiryDate);
  const paymentStatus = input.paymentStatus ?? "PENDING";

  const status =
    expiry < new Date()
      ? "EXPIRED"
      : expiry.getTime() - Date.now() <= 7 * 86400_000
      ? "EXPIRING_SOON"
      : "ACTIVE";

  const membership = await db.membership.create({
    data: {
      tenantId,
      customerId: input.customerId,
      planName: input.planName,
      priceAmount: Math.max(0, input.priceAmount),
      startDate: start,
      expiryDate: expiry,
      paymentStatus,
      status,
    },
  });

  await publish(db, {
    tenantId,
    type: EventTypes.MembershipCreatedOrUpdated,
    payload: {
      membershipId: membership.id,
      customerId: customer.id,
      planName: input.planName,
      expiryDate: expiry.toISOString(),
      paymentStatus,
    },
    dedupeKey: `memb_create:${membership.id}`,
  });

  // Outbound Google Sheets sync if configured
  await syncMembershipToGoogleSheet(tenantId, membership.id);

  return membership;
}

export async function listMemberships(
  tenantId: string,
  query?: { status?: string; paymentStatus?: string; customerId?: string }
) {
  const where: Record<string, unknown> = { tenantId };
  if (query?.status) where.status = query.status;
  if (query?.paymentStatus) where.paymentStatus = query.paymentStatus;
  if (query?.customerId) where.customerId = query.customerId;

  return db.membership.findMany({
    where,
    orderBy: { expiryDate: "asc" },
    include: {
      customer: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });
}

export async function updateMembershipPayment(
  tenantId: string,
  membershipId: string,
  paymentStatus: "PAID" | "PENDING" | "OVERDUE"
) {
  const m = await db.membership.findFirst({
    where: { id: membershipId, tenantId },
  });
  if (!m) return null;

  const updated = await db.membership.update({
    where: { id: membershipId },
    data: {
      paymentStatus,
      updatedAt: new Date(),
    },
  });

  if (paymentStatus === "PAID") {
    await publish(db, {
      tenantId,
      type: EventTypes.MembershipPaymentReceived,
      payload: {
        membershipId: m.id,
        customerId: m.customerId,
        amount: m.priceAmount,
      },
      dedupeKey: `memb_paid:${m.id}:${Date.now()}`,
    });
  }

  // Real-time Google Sheets update
  await syncMembershipToGoogleSheet(tenantId, membershipId);

  return updated;
}

/**
 * Calculates end-of-day gym metrics and emits executive summary event
 */
export async function generateGymDailyDigest(tenantId: string) {
  const now = new Date();
  const in7Days = new Date(Date.now() + 7 * 86400_000);

  const [activeCount, expiredCount, pendingMemberships, expiringSoonCount] = await Promise.all([
    db.membership.count({ where: { tenantId, status: "ACTIVE" } }),
    db.membership.count({ where: { tenantId, status: "EXPIRED" } }),
    db.membership.findMany({
      where: { tenantId, paymentStatus: { in: ["PENDING", "OVERDUE"] } },
      select: { priceAmount: true },
    }),
    db.membership.count({
      where: { tenantId, status: { in: ["ACTIVE", "EXPIRING_SOON"] }, expiryDate: { lte: in7Days, gte: now } },
    }),
  ]);

  const pendingDuesAmount = pendingMemberships.reduce((sum, item) => sum + item.priceAmount, 0);
  const todayDate = now.toISOString().slice(0, 10);

  await publish(db, {
    tenantId,
    type: EventTypes.OpsDailyGymSummary,
    payload: {
      date: todayDate,
      activeCount,
      expiredCount,
      pendingDuesAmount,
      expiringIn7DaysCount: expiringSoonCount,
    },
    dedupeKey: `gymsummary:${tenantId}:${todayDate}`,
  });

  return {
    date: todayDate,
    activeCount,
    expiredCount,
    pendingDuesAmount,
    expiringIn7DaysCount: expiringSoonCount,
  };
}

/**
 * SSRF-validated outbound Google Sheets webhook sync
 */
export async function syncMembershipToGoogleSheet(tenantId: string, membershipId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  const settings = readSettings(tenant);
  const sheetWebhookUrl = settings.vertical?.gym?.googleSheetsSyncUrl;
  if (!sheetWebhookUrl) return;

  const membership = await db.membership.findFirst({
    where: { id: membershipId, tenantId },
    include: { customer: { select: { name: true, phone: true, email: true } } },
  });
  if (!membership) return;

  try {
    await safeFetch(
      sheetWebhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipId: membership.id,
          customerName: membership.customer.name,
          customerPhone: membership.customer.phone,
          plan: membership.planName,
          price: membership.priceAmount,
          startDate: membership.startDate.toISOString(),
          expiryDate: membership.expiryDate.toISOString(),
          status: membership.status,
          paymentStatus: membership.paymentStatus,
          timestamp: new Date().toISOString(),
        }),
      },
      { allowHttpInDev: true }
    );
    await logEvent("info", "gym", `Synced membership ${membership.id} to Google Sheets`, { membershipId }, tenantId);
  } catch (err) {
    await logEvent("warn", "gym", `Google Sheets sync failed: ${(err as Error).message}`, { membershipId }, tenantId);
  }
}
