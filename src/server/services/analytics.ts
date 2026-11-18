import { db } from "@/lib/db";

/**
 * Analytics — every number is computed live from tenant data with SQL
 * aggregates. No fabricated metrics. Sandbox demo tenants run on seeded
 * demo transactions (clearly labelled as demo data in the UI).
 */

export type Range = { from: Date; to: Date };

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function overview(tenantId: string, range: Range) {
  const [customersTotal, activeCustomers, newInRange, visits, feedbackAgg, messages, redemptions, upcomingBirthdays, appointments] =
    await Promise.all([
      db.customer.count({ where: { tenantId } }),
      db.customer.count({ where: { tenantId, status: "active" } }),
      db.customer.count({ where: { tenantId, createdAt: { gte: range.from, lte: range.to } } }),
      db.visit.findMany({
        where: { tenantId, occurredAt: { gte: range.from, lte: range.to } },
        select: { occurredAt: true, amountCents: true, customerId: true },
      }),
      db.feedback.aggregate({ where: { tenantId, createdAt: { gte: range.from, lte: range.to } }, _avg: { rating: true }, _count: true }),
      db.message.groupBy({ by: ["status"], where: { tenantId, createdAt: { gte: range.from, lte: range.to } }, _count: true }),
      db.offerRedemption.count({ where: { tenantId, createdAt: { gte: range.from, lte: range.to } } }),
      db.customer.findMany({
        where: { tenantId, status: "active", birthdayMonth: { not: null } },
        select: { id: true, name: true, birthdayMonth: true, birthdayDay: true },
      }),
      db.appointment.groupBy({ by: ["status"], where: { tenantId, startAt: { gte: range.from, lte: range.to } }, _count: true }),
    ]);

  // Customer growth series (new + cumulative) over the range by month.
  const allCustomers = await db.customer.findMany({
    where: { tenantId },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const growthByMonth = new Map<string, number>();
  for (const c of allCustomers) growthByMonth.set(monthKey(c.createdAt), (growthByMonth.get(monthKey(c.createdAt)) ?? 0) + 1);

  const months: string[] = [];
  const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  while (cursor <= range.to) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const totalBefore = allCustomers.filter((c) => c.createdAt < range.from).length;
  let cumulative = totalBefore;
  const growthSeries = months.map((m) => {
    const newIn = growthByMonth.get(m) ?? 0;
    cumulative += newIn;
    return { month: m, newCustomers: newIn, cumulative };
  });

  // Visits / revenue by month
  const visitByMonth = new Map<string, { visits: number; revenueCents: number }>();
  for (const v of visits) {
    const k = monthKey(v.occurredAt);
    const entry = visitByMonth.get(k) ?? { visits: 0, revenueCents: 0 };
    entry.visits += 1;
    entry.revenueCents += v.amountCents;
    visitByMonth.set(k, entry);
  }
  const visitSeries = months.map((m) => ({
    month: m,
    visits: visitByMonth.get(m)?.visits ?? 0,
    revenueCents: visitByMonth.get(m)?.revenueCents ?? 0,
  }));

  // Feedback trend by month
  const feedbackRows = await db.feedback.findMany({
    where: { tenantId, createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true, rating: true },
  });
  const fbByMonth = new Map<string, { total: number; count: number }>();
  for (const f of feedbackRows) {
    const k = monthKey(f.createdAt);
    const e = fbByMonth.get(k) ?? { total: 0, count: 0 };
    e.total += f.rating;
    e.count += 1;
    fbByMonth.set(k, e);
  }
  const feedbackSeries = months.map((m) => {
    const e = fbByMonth.get(m);
    return { month: m, avg: e && e.count ? Math.round((e.total / e.count) * 10) / 10 : 0, count: e?.count ?? 0 };
  });

  // Upcoming birthdays within 14 days (computed, not stored)
  const upcoming = upcomingBirthdays
    .map((c) => {
      if (!c.birthdayMonth || !c.birthdayDay) return null;
      const now = new Date();
      for (let year = now.getUTCFullYear(); year <= now.getUTCFullYear() + 1; year++) {
        const d = new Date(Date.UTC(year, c.birthdayMonth - 1, c.birthdayDay));
        const days = Math.round((d.getTime() - now.getTime()) / 86400_000);
        if (days >= 0 && days <= 14) return { id: c.id, name: c.name, inDays: days, date: d.toISOString().slice(0, 10) };
      }
      return null;
    })
    .filter(Boolean) as { id: string; name: string; inDays: number; date: string }[];
  upcoming.sort((a, b) => a.inDays - b.inDays);

  const revenueCents = visits.reduce((s, v) => s + v.amountCents, 0);
  const repeatVisitors = new Set(visits.filter((v) => v.customerId).map((v) => v.customerId));
  const distinctVisitors = repeatVisitors.size;

  return {
    kpis: {
      customersTotal,
      activeCustomers,
      newInRange,
      visitsInRange: visits.length,
      distinctVisitors,
      revenueCents,
      avgTicketCents: visits.length ? Math.round(revenueCents / visits.length) : 0,
      feedbackAvg: feedbackAgg._avg.rating ? Math.round(feedbackAgg._avg.rating * 10) / 10 : null,
      feedbackCount: feedbackAgg._count,
      redemptions,
      upcomingBirthdays: upcoming.slice(0, 8).length,
    },
    growthSeries,
    visitSeries,
    feedbackSeries,
    messageStatuses: messages.map((m) => ({ status: m.status, count: m._count })),
    appointmentStatuses: appointments.map((a) => ({ status: a.status, count: a._count })),
    upcomingBirthdays: upcoming.slice(0, 8),
  };
}

export async function customerIntelligence(tenantId: string, range: Range) {
  const customers = await db.customer.findMany({
    where: { tenantId },
    select: { id: true, createdAt: true, source: true, status: true, visitCount: true, totalSpendCents: true, pointsBalance: true, lastVisitAt: true, firstVisitAt: true },
  });

  // acquisition sources
  const sources = new Map<string, number>();
  for (const c of customers) sources.set(c.source, (sources.get(c.source) ?? 0) + 1);

  // repeat / inactive
  const repeat = customers.filter((c) => c.visitCount >= 2).length;
  const inactiveCutoff = Date.now() - 45 * 86400_000;
  const inactive = customers.filter((c) => c.status === "active" && (!c.lastVisitAt || c.lastVisitAt.getTime() < inactiveCutoff)).length;

  // CLV bands (computed lifetime spend)
  const bands = [
    { band: "₹0 (no spend)", min: 0, max: 0 },
    { band: "₹1–5k", min: 1, max: 500000 },
    { band: "₹5k–15k", min: 500001, max: 1500000 },
    { band: "₹15k–40k", min: 1500001, max: 4000000 },
    { band: "₹40k+", min: 4000001, max: Number.MAX_SAFE_INTEGER },
  ].map((b) => ({ band: b.band, count: customers.filter((c) => c.totalSpendCents >= b.min && c.totalSpendCents <= b.max).length }));

  // retention cohorts: first-visit month -> % with a later visit
  const visits = await db.visit.findMany({
    where: { tenantId },
    select: { customerId: true, occurredAt: true },
  });
  const firstVisitByCustomer = new Map<string, Date>();
  for (const c of customers) if (c.firstVisitAt) firstVisitByCustomer.set(c.id, c.firstVisitAt);
  const visitsByCustomer = new Map<string, Date[]>();
  for (const v of visits) {
    const arr = visitsByCustomer.get(v.customerId) ?? [];
    arr.push(v.occurredAt);
    visitsByCustomer.set(v.customerId, arr);
  }
  const cohortMap = new Map<string, { size: number; returned: number }>();
  for (const [customerId, firstVisit] of firstVisitByCustomer) {
    if (firstVisit < range.from || firstVisit > range.to) continue;
    const k = monthKey(firstVisit);
    const e = cohortMap.get(k) ?? { size: 0, returned: 0 };
    e.size += 1;
    const later = (visitsByCustomer.get(customerId) ?? []).some((d) => d.getTime() > firstVisit.getTime() + 7 * 86400_000);
    if (later) e.returned += 1;
    cohortMap.set(k, e);
  }
  const cohorts = [...cohortMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, e]) => ({ cohortMonth: month, size: e.size, returned: e.returned, retentionPct: e.size ? Math.round((e.returned / e.size) * 100) : 0 }));

  const newInRange = customers.filter((c) => c.createdAt >= range.from && c.createdAt <= range.to).length;

  return {
    totalCustomers: customers.length,
    newInRange,
    repeatCustomers: repeat,
    repeatPct: customers.length ? Math.round((repeat / customers.length) * 100) : 0,
    inactive,
    inactivePct: customers.length ? Math.round((inactive / customers.length) * 100) : 0,
    sources: [...sources.entries()].map(([source, count]) => ({ source, count })),
    clvBands: bands,
    cohorts,
    avgClvCents: customers.length ? Math.round(customers.reduce((s, c) => s + c.totalSpendCents, 0) / customers.length) : 0,
  };
}

export async function feedbackTrends(tenantId: string, range: Range) {
  const rows = await db.feedback.findMany({
    where: { tenantId, createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true, rating: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const distribution = [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: rows.filter((f) => f.rating === r).length }));
  const byMonth = new Map<string, { total: number; count: number }>();
  for (const f of rows) {
    const k = monthKey(f.createdAt);
    const e = byMonth.get(k) ?? { total: 0, count: 0 };
    e.total += f.rating;
    e.count += 1;
    byMonth.set(k, e);
  }
  const trend = [...byMonth.entries()].map(([month, e]) => ({
    month,
    avg: Math.round((e.total / e.count) * 10) / 10,
    count: e.count,
  }));
  const avg = rows.length ? Math.round((rows.reduce((s, f) => s + f.rating, 0) / rows.length) * 10) / 10 : null;
  return { count: rows.length, avg, distribution, trend, pendingReview: rows.filter((f) => f.status === "new").length };
}

export async function appointmentPerformance(tenantId: string, range: Range) {
  const rows = await db.appointment.findMany({
    where: { tenantId, startAt: { gte: range.from, lte: range.to } },
    select: { status: true, serviceId: true, startAt: true },
  });
  const services = await db.service.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const byStatus = ["scheduled", "confirmed", "completed", "cancelled", "no_show"].map((s) => ({
    status: s,
    count: rows.filter((a) => a.status === s).length,
  }));
  const completed = byStatus.find((s) => s.status === "completed")?.count ?? 0;
  const noShow = byStatus.find((s) => s.status === "no_show")?.count ?? 0;
  const serviceCounts = services
    .map((s) => ({ service: s.name, count: rows.filter((a) => a.serviceId === s.id).length }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = rows.length;
  return {
    total,
    byStatus,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    noShowRate: total ? Math.round((noShow / total) * 100) : 0,
    topServices: serviceCounts.slice(0, 6),
  };
}

export async function loyaltyStats(tenantId: string, range: Range) {
  const txns = await db.rewardTransaction.findMany({
    where: { tenantId, createdAt: { gte: range.from, lte: range.to } },
    select: { kind: true, points: true },
  });
  const customers = await db.customer.findMany({
    where: { tenantId, status: "active" },
    select: { pointsBalance: true },
  });
  const issued = txns.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0);
  const redeemed = Math.abs(txns.filter((t) => t.points < 0).reduce((s, t) => s + t.points, 0));
  return {
    pointsIssued: issued,
    pointsRedeemed: redeemed,
    activeMembers: customers.filter((c) => c.pointsBalance > 0).length,
    avgBalance: customers.length ? Math.round(customers.reduce((s, c) => s + c.pointsBalance, 0) / customers.length) : 0,
    transactionCount: txns.length,
  };
}
