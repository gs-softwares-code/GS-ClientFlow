import { db } from "@/lib/db";
import { parseJson } from "@/server/lib/json";

/**
 * Segmentation engine — rules are evaluated server-side against lightweight
 * customer projections (no over-fetching: only fields the rules need are read).
 * Membership is computed on demand rather than stored, so segments are always
 * current with customer aggregates.
 */

export type RuleAttr =
  | "status"
  | "source"
  | "visitCount"
  | "totalSpendCents"
  | "pointsBalance"
  | "lastVisitDaysAgo"
  | "birthdayMonth"
  | "tag"
  | "feedbackAvg"
  | "feedbackRating"; // event-scoped (feedback.submitted payloads)

export type RuleOp = "eq" | "neq" | "gte" | "lte" | "in" | "between";

export type SegmentRule = {
  attr: RuleAttr;
  op: RuleOp;
  value: string | number | (string | number)[];
};

export type CustomerLite = {
  id: string;
  status: string;
  source: string;
  visitCount: number;
  totalSpendCents: number;
  pointsBalance: number;
  lastVisitAt: Date | null;
  createdAt: Date;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  tagIds: string[];
  feedbackAvg: number | null;
};

export function parseRules(raw: string | null | undefined): SegmentRule[] {
  const rules = parseJson<SegmentRule[]>(raw, []);
  return Array.isArray(rules) ? rules.filter((r) => r && typeof r.attr === "string") : [];
}

export function matchesRules(
  lite: CustomerLite,
  rules: SegmentRule[],
  eventContext?: { feedbackRating?: number }
): boolean {
  for (const rule of rules) {
    let left: string | number | null = null;
    switch (rule.attr) {
      case "status": left = lite.status; break;
      case "source": left = lite.source; break;
      case "visitCount": left = lite.visitCount; break;
      case "totalSpendCents": left = lite.totalSpendCents; break;
      case "pointsBalance": left = lite.pointsBalance; break;
      case "birthdayMonth": left = lite.birthdayMonth ?? -1; break;
      case "tag":
        if (!Array.isArray(rule.value)) return false;
        left = lite.tagIds.some((t) => (Array.isArray(rule.value) ? rule.value.includes(t) : false)) ? "yes" : "no";
        break;
      case "lastVisitDaysAgo":
        left = lite.lastVisitAt ? Math.floor((Date.now() - lite.lastVisitAt.getTime()) / 86400_000) : 9999;
        break;
      case "feedbackAvg":
        left = lite.feedbackAvg !== null ? Math.round(lite.feedbackAvg * 10) / 10 : null;
        break;
      case "feedbackRating":
        left = eventContext?.feedbackRating ?? null;
        break;
    }

    if (left === null) return false;

    if (rule.op === "in") {
      if (!Array.isArray(rule.value)) return false;
      if (!rule.value.map(String).includes(String(left))) return false;
      continue;
    }
    if (rule.op === "between") {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return false;
      const lo = Number(rule.value[0]);
      const hi = Number(rule.value[1]);
      if (!(Number(left) >= lo && Number(left) <= hi)) return false;
      continue;
    }

    const rv = typeof rule.value === "number" ? rule.value : Number(rule.value);
    const lv = Number(left);
    const sv = String(left);
    const rs = String(rule.value);

    switch (rule.op) {
      case "eq": if (!(sv === rs || lv === rv)) return false; break;
      case "neq": if (sv === rs || (Number.isFinite(lv) && Number.isFinite(rv) && lv === rv)) return false; break;
      case "gte": if (!(lv >= rv)) return false; break;
      case "lte": if (!(lv <= rv)) return false; break;
    }
  }
  return true;
}

/** Load only the fields rules need — avoids over-fetching. */
export async function loadCustomerLites(tenantId: string, customerIds?: string[]): Promise<CustomerLite[]> {
  const customers = await db.customer.findMany({
    where: { tenantId, ...(customerIds ? { id: { in: customerIds } } : {}) },
    select: {
      id: true, status: true, source: true, visitCount: true, totalSpendCents: true,
      pointsBalance: true, lastVisitAt: true, createdAt: true, birthdayMonth: true, birthdayDay: true,
      tags: { select: { tagId: true } },
    },
  });

  const feedbackAgg = await db.feedback.groupBy({
    by: ["customerId"],
    where: { tenantId },
    _avg: { rating: true },
  });
  const avgByCustomer = new Map(feedbackAgg.map((f) => [f.customerId, f._avg.rating]));

  return customers.map((c) => ({
    id: c.id,
    status: c.status,
    source: c.source,
    visitCount: c.visitCount,
    totalSpendCents: c.totalSpendCents,
    pointsBalance: c.pointsBalance,
    lastVisitAt: c.lastVisitAt,
    createdAt: c.createdAt,
    birthdayMonth: c.birthdayMonth,
    birthdayDay: c.birthdayDay,
    tagIds: c.tags.map((t) => t.tagId),
    feedbackAvg: avgByCustomer.get(c.id) ?? null,
  }));
}

export async function resolveAudienceIds(
  tenantId: string,
  opts: { segmentId?: string | null; rules?: SegmentRule[] },
  eventContext?: { feedbackRating?: number }
): Promise<string[]> {
  let rules: SegmentRule[] = opts.rules ?? [];
  if (opts.segmentId) {
    const segment = await db.segment.findFirst({ where: { id: opts.segmentId, tenantId } });
    if (segment) rules = parseRules(segment.rules);
  }
  if (!rules.length) {
    // no rules -> all active customers
    const rows = await db.customer.findMany({
      where: { tenantId, status: "active" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const lites = await loadCustomerLites(tenantId);
  return lites.filter((l) => l.status === "active" && matchesRules(l, rules, eventContext)).map((l) => l.id);
}

export async function segmentMemberCount(tenantId: string, segmentId: string): Promise<number> {
  return (await resolveAudienceIds(tenantId, { segmentId })).length;
}

export function defaultCustomerLiteFromLites(tenantId: string, customerId: string, lites: CustomerLite[]): CustomerLite | null {
  return lites.find((l) => l.id === customerId) ?? null;
}
