import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute, jsonError } from "@/server/tenancy/guard";
import { customerIntelligence, feedbackTrends, appointmentPerformance, loyaltyStats, overview } from "@/server/services/analytics";
import { campaignStats } from "@/server/services/campaigns";

/** CSV export — every report is computed from live tenant data with CSV Injection protection. */
function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Neutralize CSV Formula Injection (CWE-1236)
  // If a field begins with =, +, -, @, tab, or carriage return, prepend a single quote
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(Date.now() - 90 * 86400_000);
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
    const report = params.report;
    let rows: (string | number | null | undefined)[][] = [];
    let name = report;

    switch (report) {
      case "customers": {
        const data = await db.customer.findMany({
          where: { tenantId: ctx.tenant.id },
          orderBy: { createdAt: "desc" },
          include: { tags: { select: { tag: { select: { name: true } } } } },
        });
        rows = [
          ["Name", "Email", "Phone", "Source", "Status", "Visits", "Lifetime spend (INR)", "Points", "Last visit", "Registered", "Tags"],
          ...data.map((c) => [
            c.name, c.email, c.phone ?? "", c.source, c.status, c.visitCount,
            (c.totalSpendCents / 100).toFixed(2), c.pointsBalance,
            c.lastVisitAt?.toISOString().slice(0, 10) ?? "", c.createdAt.toISOString().slice(0, 10),
            c.tags.map((t) => t.tag.name).join("; "),
          ]),
        ];
        break;
      }
      case "feedback": {
        const data = await db.feedback.findMany({
          where: { tenantId: ctx.tenant.id, createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: "desc" },
          include: { customer: { select: { name: true, email: true } } },
        });
        rows = [
          ["Date", "Customer", "Email", "Rating", "Status", "Follow-up", "Comment"],
          ...data.map((f) => [
            f.createdAt.toISOString().slice(0, 10), f.customer.name, f.customer.email, f.rating,
            f.status, f.followUpStatus, f.comment ?? "",
          ]),
        ];
        break;
      }
      case "campaigns": {
        const data = await campaignStats(ctx.tenant.id);
        rows = [
          ["Campaign", "Channel", "Status", "Audience", "Sent", "Delivered", "Read", "Failed", "Skipped", "Scheduled", "Completed"],
          ...data.map((c) => [
            c.name, c.channel, c.status, c.segmentName ?? "all customers", c.total, c.delivered, c.read, c.failed, c.skipped,
            c.scheduledAt?.toISOString() ?? "", c.completedAt?.toISOString() ?? "",
          ]),
        ];
        break;
      }
      case "appointments": {
        const data = await db.appointment.findMany({
          where: { tenantId: ctx.tenant.id, startAt: { gte: from, lte: to } },
          orderBy: { startAt: "asc" },
          include: { customer: { select: { name: true } }, service: { select: { name: true } }, staff: { select: { name: true } } },
        });
        rows = [
          ["Start", "Customer", "Service", "Staff", "Duration (min)", "Status", "Reminder sent", "Follow-up sent"],
          ...data.map((a) => [
            a.startAt.toISOString(), a.customer.name, a.service?.name ?? "", a.staff?.name ?? "", a.durationMin,
            a.status, a.reminderSentAt ? "yes" : "no", a.followUpAt ? "yes" : "no",
          ]),
        ];
        break;
      }
      case "loyalty": {
        const data = await db.rewardTransaction.findMany({
          where: { tenantId: ctx.tenant.id },
          orderBy: { createdAt: "desc" },
          include: { customer: { select: { name: true, email: true } } },
        });
        rows = [
          ["Date", "Customer", "Email", "Type", "Points", "Balance after", "Reason", "Idempotency key"],
          ...data.map((t) => [
            t.createdAt.toISOString(), t.customer.name, t.customer.email, t.kind, t.points, t.balanceAfter, t.reason, t.idempotencyKey,
          ]),
        ];
        break;
      }
      case "analytics-summary": {
        const [o, ci, fb, ap, lo] = await Promise.all([
          overview(ctx.tenant.id, { from, to }),
          customerIntelligence(ctx.tenant.id, { from, to }),
          feedbackTrends(ctx.tenant.id, { from, to }),
          appointmentPerformance(ctx.tenant.id, { from, to }),
          loyaltyStats(ctx.tenant.id, { from, to }),
        ]);
        rows = [
          ["GS ClientFlow analytics summary"],
          ["Business", ctx.tenant.name],
          ["Range", `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`],
          [],
          ["Metric", "Value"],
          ["Total customers", o.kpis.customersTotal],
          ["Active customers", o.kpis.activeCustomers],
          ["New customers (range)", o.kpis.newInRange],
          ["Visits (range)", o.kpis.visitsInRange],
          ["Distinct visitors (range)", o.kpis.distinctVisitors],
          ["Revenue (range, INR)", (o.kpis.revenueCents / 100).toFixed(2)],
          ["Average ticket (INR)", (o.kpis.avgTicketCents / 100).toFixed(2)],
          ["Feedback average", o.kpis.feedbackAvg ?? "n/a"],
          ["Feedback count", o.kpis.feedbackCount],
          ["Offer redemptions", o.kpis.redemptions],
          ["Repeat customers", ci.repeatCustomers],
          ["Repeat rate %", ci.repeatPct],
          ["Inactive customers", ci.inactive],
          ["Average CLV (INR)", (ci.avgClvCents / 100).toFixed(2)],
          ["Appointment completion rate %", ap.completionRate],
          ["No-show rate %", ap.noShowRate],
          ["Points issued", lo.pointsIssued],
          ["Points redeemed", lo.pointsRedeemed],
          [],
          ["Customer growth by month"],
          ["Month", "New", "Cumulative"],
          ...o.growthSeries.map((g) => [g.month, g.newCustomers, g.cumulative]),
          [],
          ["Acquisition sources"],
          ["Source", "Customers"],
          ...ci.sources.map((s) => [s.source, s.count]),
          [],
          ["Feedback trend by month"],
          ["Month", "Average", "Count"],
          ...fb.trend.map((t) => [t.month, t.avg, t.count]),
        ];
        break;
      }
      default:
        return jsonError("bad_request", "Unknown report", 400);
    }

    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${ctx.tenant.slug}-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }, { name: "export", limitPerMinute: 10 })(req);
}

export const dynamic = "force-dynamic";
