import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { couponCode } from "@/server/lib/ids";
import type { Coupon } from "@prisma/client";

/** Offers, coupons and redemptions (idempotent redemption + event publish). */

export async function createOffer(
  tenantId: string,
  input: {
    title: string;
    description?: string | null;
    kind?: string;
    value?: number;
    channel?: string;
    segmentId?: string | null;
    startsAt?: string | null;
    expiresAt?: string | null;
  }
) {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        tenantId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        kind: input.kind ?? "discount",
        value: Math.max(0, Math.round(input.value ?? 0)),
        channel: input.channel ?? "email",
        segmentId: input.segmentId ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: "active",
      },
    });
    await publish(tx, {
      tenantId,
      type: EventTypes.OfferCreated,
      payload: { offerId: offer.id, title: offer.title, kind: offer.kind },
      dedupeKey: `offercreated:${offer.id}`,
    });
    return offer;
  });
}

export async function listOffers(tenantId: string, opts: { status?: string | null } = {}) {
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  const offers = await db.offer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      coupons: { select: { id: true, code: true, status: true, customerId: true } },
      redemptions: { select: { id: true, customerId: true, createdAt: true } },
    },
  });
  return offers.map((o) => ({
    ...o,
    couponCount: o.coupons.length,
    redemptionCount: o.redemptions.length,
  }));
}

export async function generateCoupons(tenantId: string, offerId: string, count: number, businessName: string) {
  const offer = await db.offer.findFirst({ where: { id: offerId, tenantId } });
  if (!offer) return null;
  const n = Math.min(Math.max(count, 1), 200);
  const coupons: Coupon[] = [];
  for (let i = 0; i < n; i++) {
    coupons.push(
      await db.coupon.create({
        data: {
          tenantId,
          offerId,
          code: couponCode(businessName),
          status: "active",
          expiresAt: offer.expiresAt,
        },
      })
    );
  }
  return coupons;
}

export async function redeemOffer(
  tenantId: string,
  input: { offerId: string; customerId: string; couponCode?: string | null }
) {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findFirst({ where: { id: input.offerId, tenantId } });
    if (!offer) throw Object.assign(new Error("Offer not found in this tenant"), { code: "not_found" });
    if (offer.status !== "active") throw Object.assign(new Error("Offer is not active"), { code: "inactive_offer" });
    if (offer.expiresAt && offer.expiresAt < new Date()) {
      throw Object.assign(new Error("Offer already expired"), { code: "expired" });
    }
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId } });
    if (!customer) throw Object.assign(new Error("Customer not found in this tenant"), { code: "not_found" });

    // Idempotent redemption: unique constraint on (offerId, customerId).
    const existing = await tx.offerRedemption.findFirst({ where: { offerId: input.offerId, customerId: input.customerId } });
    if (existing) {
      return { duplicate: true, redemptionId: existing.id, couponCode: null };
    }

    let couponId: string | null = null;
    let code: string | null = null;
    if (input.couponCode) {
      const coupon = await tx.coupon.findFirst({
        where: { tenantId, code: input.couponCode.trim().toUpperCase(), status: "active" },
      });
      if (!coupon) throw Object.assign(new Error("Coupon code not found"), { code: "coupon_not_found" });
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        throw Object.assign(new Error("Coupon expired"), { code: "coupon_expired" });
      }
      await tx.coupon.update({ where: { id: coupon.id }, data: { status: "redeemed", redeemedAt: new Date(), customerId: input.customerId } });
      couponId = coupon.id;
      code = coupon.code;
    }

    const redemption = await tx.offerRedemption.create({
      data: {
        tenantId,
        offerId: input.offerId,
        customerId: input.customerId,
        couponId,
        idempotencyKey: `redeem:${input.offerId}:${input.customerId}`,
      },
    });

    await publish(tx, {
      tenantId,
      type: EventTypes.OfferRedeemed,
      payload: { redemptionId: redemption.id, offerId: input.offerId, customerId: input.customerId, couponCode: code },
      dedupeKey: `offerredeemed:${redemption.id}`,
    });
    return { duplicate: false, redemptionId: redemption.id, couponCode: code };
  });
}

export async function listCoupons(tenantId: string, opts: { status?: string | null; offerId?: string | null; customerId?: string | null } = {}) {
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  if (opts.offerId) where.offerId = opts.offerId;
  if (opts.customerId) where.customerId = opts.customerId;
  return db.coupon.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { offer: { select: { id: true, title: true, kind: true } } },
  });
}
