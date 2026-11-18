import { db } from "@/lib/db";

/** Tenant-level usage metering + plan limits (quota enforcement). */

export const METRICS = ["requests", "messages", "registrations", "customers"] as const;
export type UsageMetric = (typeof METRICS)[number];

export const PLAN_LIMITS: Record<string, Record<UsageMetric, number>> = {
  starter: { requests: 120, messages: 500, registrations: 200, customers: 500 },
  growth: { requests: 240, messages: 5000, registrations: 1000, customers: 2000 },
  pro: { requests: 480, messages: 20000, registrations: 5000, customers: 10000 },
};

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function meterUsage(tenantId: string, metric: UsageMetric, n = 1): Promise<void> {
  const day = dayKey();
  try {
    await db.usageCounter.upsert({
      where: { tenantId_metric_day: { tenantId, metric, day } },
      create: { tenantId, metric, day, count: n },
      update: { count: { increment: n } },
    });
  } catch {
    // metering must never break the request path
  }
}

export type UsageSnapshot = {
  plan: string;
  metrics: {
    metric: UsageMetric;
    today: number;
    last30d: number;
    limit: number;
    limitLabel: string;
    window: "per minute" | "per month" | "per month" | "per month";
    pct: number;
  }[];
};

const WINDOW: Record<UsageMetric, "per minute" | "per month"> = {
  requests: "per minute",
  messages: "per month",
  registrations: "per month",
  customers: "per month",
};

export async function usageSnapshot(tenantId: string, plan: string): Promise<UsageSnapshot> {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;
  const today = dayKey();
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const rows = await db.usageCounter.findMany({ where: { tenantId, day: { gte: from } } });

  const metrics = (METRICS as readonly UsageMetric[]).map((metric) => {
    const monthRows = rows.filter((r) => r.metric === metric);
    const last30d = monthRows.reduce((s, r) => s + r.count, 0);
    const todayCount = monthRows.find((r) => r.day === today)?.count ?? 0;
    const limit = limits[metric];
    const base = metric === "requests" ? todayCount : last30d;
    return {
      metric,
      today: todayCount,
      last30d,
      limit,
      limitLabel: limit.toLocaleString(),
      window: WINDOW[metric],
      pct: limit > 0 ? Math.min(100, Math.round((base / limit) * 100)) : 0,
    };
  });

  return { plan, metrics };
}

/** Hard quota check used before create operations (customers, sends). */
export async function withinQuota(tenantId: string, plan: string, metric: UsageMetric): Promise<boolean> {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;
  if (metric === "customers") {
    const count = await db.customer.count({ where: { tenantId, status: "active" } });
    return count < limits.customers;
  }
  if (metric === "requests") return true; // enforced by the token bucket, not a quota
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const rows = await db.usageCounter.findMany({ where: { tenantId, metric, day: { gte: from } } });
  const total = rows.reduce((s, r) => s + r.count, 0);
  return total < limits[metric];
}
