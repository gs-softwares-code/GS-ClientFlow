import { db } from "@/lib/db";
import { defaultSettings } from "@/server/settings";
import { toJson, parseJson } from "@/server/lib/json";
import { publicId, referralCode as makeReferralCode, uuid, stableHash } from "@/server/lib/ids";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { executeCampaign } from "@/server/services/campaigns";
import { runDueScans } from "@/server/events/scheduler";
import { logEvent } from "@/server/logs";

/** Deterministic demo dataset (mulberry32) — aggregates are computed from the
 *  generated visit history so all analytics are internally consistent. */

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Priya", "Ananya", "Rohan", "Kavya", "Vikram", "Sneha", "Aditya", "Meera", "Rahul", "Divya", "Arjun", "Nisha", "Karan", "Pooja", "Siddharth", "Riya", "Manav", "Tanvi", "Yash", "Isha", "Nikhil", "Shreya", "Varun", "Anjali", "Dev", "Neha", "Sameer", "Kritika", "Harsh", "Simran", "Raj", "Lakshmi", "Omkar", "Trisha", "Abhay", "Ritu", "Prateek", "Vani", "Gaurav"];
const LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Nair", "Kapoor", "Gupta", "Menon", "Chopra", "Joshi", "Bose", "Rathore", "Dutta", "Sinha", "Kulkarni", "Bhatt", "Deshpande", "Verma", "Shetty", "Ghosh", "Rao", "Mehta", "Nanda", "Saxena", "Pillai", "Bajaj", "Chauhan", "Dhawan", "Gokhale", "Jain"];
const SPA_COMMENTS = ["Wonderful experience, my skin feels amazing.", "Loved the ambience and the therapist was excellent.", "Good service but had to wait 15 minutes.", "The facial was relaxing; will come back.", "Massage pressure was too light for me.", "Great value for the festive package.", "Staff was courteous and professional.", "Room was a bit cold during the session.", "Best spa in the area, highly recommend.", "Slightly rushed towards the end but nice overall."];
const DENTAL_COMMENTS = ["Painless cleaning, very professional.", "Doctor explained everything clearly.", "Waiting time was long.", "Gentle and careful with my sensitive teeth.", "Booking and reminders were very smooth.", "A bit expensive but worth it.", "Follow-up call was appreciated."];
const SOURCES = ["walk_in", "referral", "instagram", "google", "website", "campaign"] as const;

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}
function dayOffset(days: number, hours = 0): Date {
  return new Date(Date.now() + days * 86400_000 + hours * 3600_000);
}
function inrToCents(rupees: number): number {
  return Math.round(rupees) * 100;
}

export async function reseed(): Promise<{ tenants: number; customers: number }> {
  const wipeOrder = ["session", "usageCounter", "auditLog", "systemLog", "workflowRun", "workflow", "scheduledAction", "outboxEvent", "message", "campaign", "coupon", "offerRedemption", "rewardTransaction", "referralCode", "offer", "appointment", "feedback", "visit", "customerTag", "tag", "segment", "service", "staff", "user", "tenant"];
  for (const model of wipeOrder) {
    await (db as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[model].deleteMany();
  }

  const r = rng(20260226);
  let totalCustomers = 0;

  // ============================================================ Tenant A
  const auroraSettings = defaultSettings("salon_spa");
  const aurora = await db.tenant.create({
    data: {
      slug: "aurora-spa",
      name: "Aurora Spa & Wellness",
      businessCategory: "salon_spa",
      brandColor: "#0f766e",
      logoText: "AS",
      plan: "growth",
      timezone: "Asia/Calcutta",
      settings: toJson({ ...auroraSettings, channels: { ...auroraSettings.channels, whatsapp: { ...auroraSettings.channels.whatsapp, enabled: true } } }),
    },
  });

  await db.user.createMany({
    data: [
      { tenantId: aurora.id, email: "platform@gsclientflow.app", name: "Platform Admin", role: "owner", isPlatformAdmin: true },
      { tenantId: aurora.id, email: "priya@auroraspa.example", name: "Priya Sharma", role: "owner" },
      { tenantId: aurora.id, email: "rahul@auroraspa.example", name: "Rahul Verma", role: "staff" },
    ],
  });

  const tagsA = await Promise.all(
    [
      { name: "vip", color: "#b45309" },
      { name: "bridal", color: "#be185d" },
      { name: "skincare-new", color: "#15803d" },
    ].map((t) => db.tag.create({ data: { tenantId: aurora.id, ...t } }))
  );

  const segmentsA = await Promise.all([
    db.segment.create({
      data: {
        tenantId: aurora.id,
        name: "VIP (₹10k+ lifetime)",
        description: "High lifetime value guests",
        rules: toJson([{ attr: "totalSpendCents", op: "gte", value: 1000000 }]),
      },
    }),
    db.segment.create({
      data: {
        tenantId: aurora.id,
        name: "At-risk (45d+ inactive)",
        description: "No visit in the last 45 days",
        rules: toJson([{ attr: "lastVisitDaysAgo", op: "gte", value: 45 }]),
      },
    }),
    db.segment.create({
      data: {
        tenantId: aurora.id,
        name: "Birthday this month",
        rules: toJson([{ attr: "birthdayMonth", op: "eq", value: new Date().getUTCMonth() + 1 }]),
      },
    }),
  ]);

  const servicesA = await Promise.all(
    [
      { name: "Signature Facial", durationMin: 60, priceCents: inrToCents(1800) },
      { name: "Deep Tissue Massage", durationMin: 75, priceCents: inrToCents(2200) },
      { name: "Manicure & Pedicure", durationMin: 45, priceCents: inrToCents(900) },
      { name: "Hair Spa Ritual", durationMin: 90, priceCents: inrToCents(2400) },
    ].map((s) => db.service.create({ data: { tenantId: aurora.id, ...s } }))
  );
  const staffA = await Promise.all(
    [
      { name: "Priya Sharma", role: "owner", availability: toJson({}) },
      { name: "Meera Nair", role: "staff", availability: toJson({}) },
      { name: "Rahul Verma", role: "staff", availability: toJson({}) },
    ].map((s) => db.staff.create({ data: { tenantId: aurora.id, ...s } }))
  );

  // ---- Aurora customers with realistic visit histories
  const AURORA_N = 42;
  const auroraCustomers: {
    id: string; name: string; email: string; birthday: { y: number; m: number; d: number } | null;
    source: string; createdAt: Date; visits: { occurredAt: Date; amountCents: number }[]; tagIdx: number[];
  }[] = [];
  const today = new Date();
  for (let i = 0; i < AURORA_N; i++) {
    // createdAt skewed toward recent months (growth curve), spread over ~11 months
    const p = Math.pow(r(), 0.65);
    const daysAgo = Math.floor(p * 330);
    const createdAt = dayOffset(-daysAgo);
    const visits: { occurredAt: Date; amountCents: number }[] = [];
    const isNew = daysAgo < 40;
    const nVisits = isNew ? Math.floor(r() * 3) : 1 + Math.floor(r() * 11);
    for (let v = 0; v < nVisits; v++) {
      const ago = Math.max(1, Math.floor(r() * daysAgo));
      visits.push({ occurredAt: dayOffset(-ago, Math.floor(r() * 10)), amountCents: inrToCents(600 + Math.floor(r() * 3900)) });
    }
    visits.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    let birthday: { y: number; m: number; d: number } | null = null;
    if (r() < 0.85) {
      birthday = { y: 1975 + Math.floor(r() * 28), m: 1 + Math.floor(r() * 12), d: 1 + Math.floor(r() * 28) };
    }
    auroraCustomers.push({
      id: uuid(),
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      email: "",
      birthday,
      source: pick(r, SOURCES),
      createdAt,
      visits,
      tagIdx: r() < 0.22 ? [Math.floor(r() * tagsA.length)] : [],
    });
  }

  // engineered birthdays so the scheduler demonstrably fires
  const engineered = [
    { daysFromNow: 1, count: 2 },
    { daysFromNow: 3, count: 2 },
    { daysFromNow: 5, count: 1 },
    { daysFromNow: 9, count: 1 },
  ];
  let ei = 0;
  for (const spec of engineered) {
    for (let k = 0; k < spec.count; k++) {
      const cust = auroraCustomers[ei++];
      if (!cust) break;
      const target = dayOffset(spec.daysFromNow);
      cust.birthday = { y: 1990, m: target.getUTCMonth() + 1, d: Math.min(28, target.getUTCDate()) };
    }
  }

  // referral web: pick 5 referrers, refer 6 newcomers
  // (codes are created after customers exist — FK-safe ordering)
  const referrers = auroraCustomers.slice(10, 15);
  const referralCodes: { code: string; customerId: string }[] = [];
  for (const ref of referrers) {
    const code = makeReferralCode(ref.name);
    referralCodes.push({ code, customerId: ref.id });
  }
  const referred = auroraCustomers.filter((c) => c.source === "referral").slice(0, 6);

  const auroraBalance = new Map<string, number>();
  for (const c of auroraCustomers) {
    const email = `${c.name.toLowerCase().replace(/[^a-z]/g, ".")}@example.com`.replace(/\.{2,}/g, ".");
    const first = c.visits[0]?.occurredAt ?? null;
    const last = c.visits.length ? c.visits[c.visits.length - 1].occurredAt : null;
    const spend = c.visits.reduce((s, v) => s + v.amountCents, 0);
    const refCode = referred.includes(c) ? referralCodes[referred.indexOf(c) % referralCodes.length]?.code ?? null : null;
    await db.customer.create({
      data: {
        id: c.id,
        tenantId: aurora.id,
        publicId: publicId(),
        name: c.name,
        email,
        phone: `+9198${String(10000000 + Math.floor(r() * 89999999)).slice(0, 8)}`,
        birthdayYear: c.birthday?.y ?? null,
        birthdayMonth: c.birthday?.m ?? null,
        birthdayDay: c.birthday?.d ?? null,
        source: refCode ? "referral" : c.source,
        referredByCode: refCode,
        consents: toJson({
          marketing: r() < 0.85,
          email: r() < 0.9,
          sms: r() < 0.45,
          whatsapp: r() < 0.25,
        }),
        preferences: toJson({ preferredChannel: r() < 0.5 ? "email" : "sms" }),
        firstVisitAt: first,
        lastVisitAt: last,
        visitCount: c.visits.length,
        totalSpendCents: spend,
        createdAt: c.createdAt,
      },
    });
    for (const ti of c.tagIdx) {
      await db.customerTag.create({ data: { customerId: c.id, tagId: tagsA[ti].id } }).catch(() => undefined);
    }
    // loyalty ledger: per-visit earnings (exactly like the service computes)
    let balance = 0;
    for (const v of c.visits) {
      const visitId = uuid();
      await db.visit.create({ data: { id: visitId, tenantId: aurora.id, customerId: c.id, occurredAt: v.occurredAt, amountCents: v.amountCents } });
      const points = 10 + Math.floor(v.amountCents / 100) * 5;
      balance += points;
      await db.rewardTransaction.create({
        data: {
          tenantId: aurora.id, customerId: c.id, kind: "earn_visit", points, reason: "Visit completed",
          balanceAfter: balance, idempotencyKey: `visit:${visitId}`, createdAt: v.occurredAt,
        },
      });
    }
    // feedback
    if (c.visits.length && r() < 0.6) {
      const lastVisit = c.visits[c.visits.length - 1];
      const roll = r();
      const rating = roll < 0.4 ? 5 : roll < 0.7 ? 4 : roll < 0.85 ? 3 : roll < 0.95 ? 2 : 1;
      await db.feedback.create({
        data: {
          tenantId: aurora.id,
          customerId: c.id,
          rating,
          comment: rating >= 4 ? pick(r, SPA_COMMENTS).slice(0, 80) : pick(r, SPA_COMMENTS.filter((_, idx) => idx % 2 === 1)).slice(0, 80),
          status: r() < 0.3 ? "new" : "reviewed",
          createdAt: new Date(lastVisit.occurredAt.getTime() + 3 * 86400_000),
        },
      });
    }
    auroraBalance.set(c.id, balance);
    await db.customer.update({ where: { id: c.id }, data: { pointsBalance: balance } });
    totalCustomers += 1;
  }

  // referral rewards (both sides, once each) — uses the real idempotency keys
  for (const ref of referrers) {
    await db.referralCode.create({ data: { tenantId: aurora.id, customerId: ref.id, code: referralCodes.find((rc) => rc.customerId === ref.id)!.code, usesCount: 0 } });
  }
  for (let i = 0; i < referred.length; i++) {
    const newcomer = referred[i];
    const referrer = referrers[i % referrers.length];
    const refCodeRow = await db.referralCode.findFirst({ where: { tenantId: aurora.id, customerId: referrer.id } });
    if (!refCodeRow || !newcomer) continue;
    await db.customer.update({ where: { id: newcomer.id }, data: { referredByCode: refCodeRow.code } });
    const refBalance = auroraBalance.get(referrer.id) ?? 0;
    await db.rewardTransaction.create({
      data: { tenantId: aurora.id, customerId: referrer.id, kind: "earn_referral", points: 100, reason: "Referral signup", balanceAfter: refBalance + 100, idempotencyKey: `referral:${newcomer.id}` },
    });
    await db.referralCode.update({ where: { id: refCodeRow.id }, data: { usesCount: { increment: 1 } } });
    await db.customer.update({ where: { id: referrer.id }, data: { pointsBalance: refBalance + 100 } });
    const nb = auroraBalance.get(newcomer.id) ?? 0;
    auroraBalance.set(newcomer.id, nb + 100);
    await db.customer.update({ where: { id: newcomer.id }, data: { pointsBalance: nb + 100 } });
    await db.rewardTransaction.create({
      data: { tenantId: aurora.id, customerId: newcomer.id, kind: "bonus", points: 100, reason: "Welcome referral bonus", balanceAfter: nb + 100, idempotencyKey: `referralwelcome:${newcomer.id}` },
    });
  }

  // ---- Aurora appointments (past completed + upcoming + no-show + cancelled)
  const visiting = auroraCustomers.filter((c) => c.visits.length > 0);
  for (let i = 0; i < 8; i++) {
    const cust = visiting[i + 4];
    if (!cust) break;
    await db.appointment.create({
      data: {
        tenantId: aurora.id,
        customerId: cust.id,
        serviceId: servicesA[i % servicesA.length].id,
        staffId: staffA[i % staffA.length].id,
        startAt: dayOffset(-(14 + i * 3), 10 + (i % 6)),
        durationMin: servicesA[i % servicesA.length].durationMin,
        status: "completed",
        reminderSentAt: dayOffset(-(15 + i * 3)),
        followUpAt: dayOffset(-(14 + i * 3), 2),
      },
    });
  }
  for (let i = 0; i < 6; i++) {
    const cust = auroraCustomers[i + 30] ?? auroraCustomers[i];
    if (!cust) break;
    await db.appointment.create({
      data: {
        tenantId: aurora.id,
        customerId: cust.id,
        serviceId: servicesA[i % servicesA.length].id,
        staffId: staffA[i % staffA.length].id,
        startAt: dayOffset(i < 2 ? 1 : 3 + i * 2, 11 + (i % 7)),
        durationMin: servicesA[i % servicesA.length].durationMin,
        status: i % 2 === 0 ? "scheduled" : "confirmed",
      },
    });
  }
  if (visiting[20]) {
    await db.appointment.create({ data: { tenantId: aurora.id, customerId: visiting[20].id, serviceId: servicesA[0].id, staffId: staffA[1].id, startAt: dayOffset(-6, 15), durationMin: 60, status: "no_show" } });
  }
  if (visiting[21]) {
    await db.appointment.create({ data: { tenantId: aurora.id, customerId: visiting[21].id, serviceId: servicesA[1].id, staffId: staffA[2].id, startAt: dayOffset(-4, 16), durationMin: 75, status: "cancelled", note: "Customer rescheduling" } });
  }

  // ============================================================ Tenant B
  const brightSettings = { ...defaultSettings("dental"), modules: { ...defaultSettings("dental").modules, loyalty: false } };
  const bright = await db.tenant.create({
    data: {
      slug: "bright-dental",
      name: "Bright Smile Dental",
      businessCategory: "dental",
      brandColor: "#a16207",
      logoText: "BS",
      plan: "starter",
      timezone: "Asia/Calcutta",
      settings: toJson({ ...brightSettings, birthdayLeadDays: 5, inactiveDays: 60 }),
    },
  });
  await db.user.create({ data: { tenantId: bright.id, email: "dr.mehta@brightdental.example", name: "Dr. Anand Mehta", role: "owner" } });

  const segmentsB = await Promise.all([
    db.segment.create({
      data: {
        tenantId: bright.id,
        name: "New families",
        description: "1 or fewer visits so far",
        rules: toJson([{ attr: "visitCount", op: "lte", value: 1 }]),
      },
    }),
    db.segment.create({
      data: { tenantId: bright.id, name: "Follow-up needed", description: "Average feedback 3 or lower", rules: toJson([{ attr: "feedbackAvg", op: "lte", value: 3 }]) },
    }),
  ]);
  const servicesB = await Promise.all(
    [
      { name: "Consultation & Cleaning", durationMin: 45, priceCents: inrToCents(1200) },
      { name: "Teeth Whitening", durationMin: 60, priceCents: inrToCents(9000) },
      { name: "Root Canal", durationMin: 90, priceCents: inrToCents(6500) },
      { name: "Braces Review", durationMin: 30, priceCents: inrToCents(1500) },
    ].map((s) => db.service.create({ data: { tenantId: bright.id, ...s } }))
  );
  const staffB = await Promise.all(
    [
      { name: "Dr. Anand Mehta", role: "owner", availability: toJson({}) },
      { name: "Dr. Kulkarni", role: "staff", availability: toJson({}) },
    ].map((s) => db.staff.create({ data: { tenantId: bright.id, ...s } }))
  );

  for (let i = 0; i < 18; i++) {
    const daysAgo = Math.floor(Math.pow(r(), 0.8) * 300);
    const createdAt = dayOffset(-daysAgo);
    const visits: { occurredAt: Date; amountCents: number }[] = [];
    const nVisits = daysAgo < 40 ? Math.floor(r() * 2) : Math.floor(r() * 6);
    for (let v = 0; v < nVisits; v++) {
      const ago = Math.max(1, Math.floor(r() * daysAgo));
      visits.push({ occurredAt: dayOffset(-ago), amountCents: inrToCents(800 + Math.floor(r() * 7000)) });
    }
    visits.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const id = uuid();
    const hasBirthday = r() < 0.8;
    const target = dayOffset(6);
    await db.customer.create({
      data: {
        id,
        tenantId: bright.id,
        publicId: publicId(),
        name,
        email: `${name.toLowerCase().replace(/[^a-z]/g, ".")}@example.com`.replace(/\.{2,}/g, "."),
        phone: `+9197${String(10000000 + Math.floor(r() * 89999999)).slice(0, 8)}`,
        birthdayYear: hasBirthday ? 1980 + Math.floor(r() * 20) : null,
        birthdayMonth: i === 0 ? target.getUTCMonth() + 1 : hasBirthday ? 1 + Math.floor(r() * 12) : null,
        birthdayDay: i === 0 ? Math.min(28, target.getUTCDate()) : hasBirthday ? 1 + Math.floor(r() * 28) : null,
        source: pick(r, SOURCES),
        consents: toJson({ marketing: r() < 0.8, email: r() < 0.9, sms: r() < 0.3, whatsapp: false }),
        firstVisitAt: visits[0]?.occurredAt ?? null,
        lastVisitAt: visits.length ? visits[visits.length - 1].occurredAt : null,
        visitCount: visits.length,
        totalSpendCents: visits.reduce((s, v) => s + v.amountCents, 0),
        createdAt,
      },
    });
    for (const v of visits) {
      await db.visit.create({ data: { tenantId: bright.id, customerId: id, occurredAt: v.occurredAt, amountCents: v.amountCents } });
    }
    if (visits.length && r() < 0.5) {
      const roll = r();
      const rating = roll < 0.5 ? 5 : roll < 0.75 ? 4 : roll < 0.9 ? 3 : 2;
      await db.feedback.create({
        data: { tenantId: bright.id, customerId: id, rating, comment: rating >= 4 ? pick(r, DENTAL_COMMENTS) : pick(r, DENTAL_COMMENTS.filter((c) => /long|expensive/.test(c))), status: r() < 0.3 ? "new" : "reviewed", createdAt: new Date(visits[visits.length - 1].occurredAt.getTime() + 2 * 86400_000) },
      });
    }
    totalCustomers += 1;
  }

  // ---- Bright appointments
  const brightCustomers = await db.customer.findMany({ where: { tenantId: bright.id } });
  for (let i = 0; i < 5; i++) {
    const cust = brightCustomers[i];
    if (!cust) break;
    await db.appointment.create({
      data: {
        tenantId: bright.id,
        customerId: cust.id,
        serviceId: servicesB[i % servicesB.length].id,
        staffId: staffB[i % staffB.length].id,
        startAt: dayOffset(-(10 + i * 4), 10),
        durationMin: servicesB[i % servicesB.length].durationMin,
        status: "completed",
        reminderSentAt: dayOffset(-(11 + i * 4)),
      },
    });
  }
  for (let i = 0; i < 3; i++) {
    const cust = brightCustomers[i + 10] ?? brightCustomers[0];
    if (!cust) break;
    await db.appointment.create({
      data: { tenantId: bright.id, customerId: cust.id, serviceId: servicesB[i % servicesB.length].id, staffId: staffB[i % staffB.length].id, startAt: dayOffset(2 + i * 3, 9 + i), durationMin: 45, status: "scheduled" },
    });
  }

  // ============================================================ Offers & coupons (Aurora)
  const offerBirthday = await db.offer.create({
    data: { tenantId: aurora.id, title: "Birthday Glow Combo", description: "Complimentary 15-minute add-on during your birthday month", kind: "birthday_greeting", value: 0, channel: "email", startsAt: dayOffset(-120), expiresAt: dayOffset(240) },
  });
  const offerFestive = await db.offer.create({
    data: { tenantId: aurora.id, title: "Festive Radiance 20% off", description: "20% off any 90-minute ritual", kind: "discount", value: 20, channel: "email", startsAt: dayOffset(-30), expiresAt: dayOffset(25) },
  });
  const offerPoints = await db.offer.create({
    data: { tenantId: aurora.id, title: "Double points week", description: "Redeem for 150 bonus points", kind: "points_bonus", value: 150, channel: "email", startsAt: dayOffset(-60), expiresAt: dayOffset(-10) },
  });
  await db.offer.create({ data: { tenantId: bright.id, title: "New patient free consultation", description: "First visit consultation complimentary", kind: "discount", value: 100, channel: "sms", startsAt: dayOffset(-90) } });

  const couponHolders = auroraCustomers.filter((c) => c.visits.length > 2).slice(0, 8);
  for (const holder of couponHolders) {
    await db.coupon.create({
      data: { tenantId: aurora.id, offerId: offerFestive.id, customerId: holder.id, code: `${makeReferralCode(holder.name).slice(0, 3)}${Math.floor(r() * 9000 + 1000)}`, status: r() < 0.4 ? "redeemed" : "active", expiresAt: offerFestive.expiresAt, redeemedAt: r() < 0.4 ? dayOffset(-5) : null },
    });
  }

  // real redemptions through the idempotent path
  const redeemers = couponHolders.slice(0, 3);
  for (const red of redeemers) {
    const coupon = await db.coupon.findFirst({ where: { tenantId: aurora.id, offerId: offerFestive.id, customerId: red.id } });
    if (!coupon || coupon.status !== "redeemed") continue;
    await db.offerRedemption.create({
      data: { tenantId: aurora.id, offerId: offerFestive.id, customerId: red.id, couponId: coupon.id, idempotencyKey: `redeem:${offerFestive.id}:${red.id}`, createdAt: dayOffset(-5) },
    });
    await publish(db, {
      tenantId: aurora.id,
      type: EventTypes.OfferRedeemed,
      payload: { redemptionId: `seed-${red.id}`, offerId: offerFestive.id, customerId: red.id, couponCode: coupon.code },
      dedupeKey: `offerredeemed:seed-${red.id}`,
    });
  }
  // bonus points offer redemption (loyalty credit happens in the handler)
  const pointsRedeemer = auroraCustomers[16];
  if (pointsRedeemer) {
    await db.offerRedemption.create({ data: { tenantId: aurora.id, offerId: offerPoints.id, customerId: pointsRedeemer.id, idempotencyKey: `redeem:${offerPoints.id}:${pointsRedeemer.id}` } });
    await publish(db, { tenantId: aurora.id, type: EventTypes.OfferRedeemed, payload: { redemptionId: `seed-${pointsRedeemer.id}`, offerId: offerPoints.id, customerId: pointsRedeemer.id }, dedupeKey: `offerredeemed:seed-${pointsRedeemer.id}` });
  }

  // ============================================================ Workflows (presets, both tenants)
  const presets = [
    { category: "birthday", name: "Birthday wishes + Glow Combo", triggerType: "date", dateKind: "birthday", channel: "email", template: "Hi {name}, happy early birthday from all of us at {business}! Show this message to claim your complimentary birthday add-on this month.", active: true },
    { category: "onboarding", name: "Welcome new customers", triggerType: "event", triggerEvent: "customer.registered", channel: "email", offsetMinutes: 2, template: "Welcome to {business}, {name}! Your first visit earns loyalty points automatically. We saved your preferences and will only message you on channels you opted into.", active: true },
    { category: "inactive", name: "Win back inactive guests", triggerType: "date", dateKind: "inactive", channel: "email", template: "Hi {name}, we have missed you at {business}! It has been a while — come back this month and enjoy a little something from us.", active: true },
    { category: "appointment_reminder", name: "Appointment reminders (24h)", triggerType: "date", dateKind: "appointment_reminder", channel: "sms", template: "Reminder: your appointment at {business} is coming up tomorrow.", active: true },
    { category: "feedback_followup", name: "Low rating follow-up", triggerType: "event", triggerEvent: "feedback.submitted", channel: "email", conditionRules: toJson([{ attr: "feedbackRating", op: "lte", value: 3 }]), template: "Hi {name}, thank you for your honest feedback at {business}. We would love to make it right — can we call you this week?", active: true },
    { category: "offer_expiry", name: "Offer expiry nudges", triggerType: "date", dateKind: "offer_expiry", channel: "email", template: "Hi {name}, your offer at {business} is about to expire — do not let it slip away!", active: true },
  ];
  for (const tenant of [aurora, bright]) {
    for (const p of presets) {
      await db.workflow.create({
        data: {
          tenantId: tenant.id,
          name: p.name,
          category: p.category,
          triggerType: p.triggerType,
          triggerEvent: p.triggerEvent ?? null,
          dateKind: p.dateKind ?? null,
          offsetMinutes: p.offsetMinutes ?? null,
          channel: p.channel,
          template: p.template,
          conditionRules: p.conditionRules ?? "[]",
          requireConsent: true,
          active: p.active,
        },
      });
    }
  }
  // a custom manual workflow on Aurora
  await db.workflow.create({
    data: {
      tenantId: aurora.id,
      name: "VIP re-invite (manual)",
      category: "custom",
      triggerType: "manual",
      channel: "whatsapp",
      template: "{name}, you are one of our favourite guests at {business} — a special ritual slot is waiting for you this weekend.",
      segmentId: segmentsA[0].id,
      requireConsent: true,
      active: true,
    },
  });

  // ============================================================ Campaigns
  const completedCampaign = await db.campaign.create({
    data: { tenantId: aurora.id, name: "Festive Glow mailer", channel: "email", template: "Hi there, our festive radiance rituals are back at Aurora. Book this week and enjoy 20% off with your coupon.", status: "draft", segmentId: null },
  });
  await executeCampaign(aurora.id, completedCampaign.id); // real sends through the adapter

  await db.campaign.create({
    data: { tenantId: aurora.id, name: "Diwali teaser (draft)", channel: "email", template: "Something luminous is coming to Aurora for Diwali...", status: "draft" },
  });

  // scheduled campaign: goes out via the event pipeline shortly after boot
  const upcomingCampaign = await db.campaign.create({
    data: { tenantId: aurora.id, name: "Monsoon restore mailer", channel: "email", template: "Hi there, monsoon skin needs extra care — enjoy {points} points toward your next ritual at Aurora this week only.", status: "draft", segmentId: segmentsA[0].id },
  });
  await db.campaign.update({ where: { id: upcomingCampaign.id }, data: { status: "scheduled", scheduledAt: new Date(Date.now() + 3 * 60_000) } });
  await publish(db, {
    tenantId: aurora.id,
    type: EventTypes.CampaignScheduled,
    payload: { campaignId: upcomingCampaign.id, scheduledAtMs: Date.now() + 3 * 60_000 },
    dedupeKey: `campsched:${upcomingCampaign.id}`,
  });

  const brightCampaign = await db.campaign.create({
    data: { tenantId: bright.id, name: "Six-month recall reminder", channel: "sms", template: "Hi there, your six-month dental check-up at Bright Smile is due. Reply BOOK to grab a slot.", status: "draft" },
  });
  await executeCampaign(bright.id, brightCampaign.id);

  // ============================================================ Engineered worker pipeline demos
  // 1. Transient retry: appointment.booked whose confirmation hash hits the
  //    sandbox provider's 503-on-first-try path -> event retries, then succeeds.
  let transientId = "";
  for (let i = 0; i < 20000; i++) {
    const candidate = uuid();
    if (stableHash(`aptconfirm:${candidate}`) % 17 === 0 && stableHash(`aptconfirm:${candidate}`) % 97 !== 0) {
      transientId = candidate;
      break;
    }
  }
  const retryCustomer = auroraCustomers[38] ?? auroraCustomers[0];
  if (transientId && retryCustomer) {
    await db.appointment.create({
      data: { id: transientId, tenantId: aurora.id, customerId: retryCustomer.id, serviceId: servicesA[0].id, staffId: staffA[1].id, startAt: dayOffset(2, 10), durationMin: 60, status: "scheduled", note: "Retry demo (sandbox provider 503 on first attempt)" },
    });
    await publish(db, { tenantId: aurora.id, type: EventTypes.AppointmentBooked, payload: { appointmentId: transientId, customerId: retryCustomer.id, startAtMs: dayOffset(2, 10).getTime() }, dedupeKey: `aptbook:${transientId}` });
  }

  // 2. Dead-letter: appointment.booked whose confirmation always hard-bounces.
  let deadId = "";
  for (let i = 0; i < 20000; i++) {
    const candidate = uuid();
    if (stableHash(`aptconfirm:${candidate}`) % 97 === 0) {
      deadId = candidate;
      break;
    }
  }
  const deadCustomer = auroraCustomers[39] ?? auroraCustomers[1];
  if (deadId && deadCustomer) {
    await db.appointment.create({
      data: { id: deadId, tenantId: aurora.id, customerId: deadCustomer.id, serviceId: servicesA[1].id, staffId: staffA[2].id, startAt: dayOffset(3, 15), durationMin: 75, status: "scheduled", note: "Dead-letter demo (sandbox provider hard bounce)" },
    });
    await publish(db, { tenantId: aurora.id, type: EventTypes.AppointmentBooked, payload: { appointmentId: deadId, customerId: deadCustomer.id, startAtMs: dayOffset(3, 15).getTime() }, dedupeKey: `aptbook:${deadId}` });
  }

  await logEvent("info", "seed", `Demo dataset seeded: 2 tenants, ${totalCustomers} customers`, { totalCustomers });
  await runDueScans().catch(() => undefined); // prime birthday/inactive events immediately
  return { tenants: 2, customers: totalCustomers };
}
