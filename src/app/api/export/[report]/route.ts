import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute, jsonError } from "@/server/tenancy/guard";
import { customerIntelligence, feedbackTrends, appointmentPerformance, loyaltyStats, overview } from "@/server/services/analytics";
import { campaignStats } from "@/server/services/campaigns";

/** CSV export — every report is computed from live tenant data with CSV Injection protection & streaming response. */
function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Neutralize CSV Formula Injection (CWE-1236)
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsvLine(row: (string | number | null | undefined)[]): string {
  return row.map(csvEscape).join(",") + "\r\n";
}

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(Date.now() - 90 * 86400_000);
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
    const report = params.report;
    const name = report;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          switch (report) {
            case "customers": {
              controller.enqueue(
                encoder.encode(
                  rowToCsvLine(["Name", "Email", "Phone", "Source", "Status", "Visits", "Lifetime spend (INR)", "Points", "Last visit", "Registered", "Tags"])
                )
              );

              // Paginated cursor fetch to prevent memory buffer exhaustion
              let cursor: string | undefined = undefined;
              let hasMore = true;

              while (hasMore) {
                const batch = await db.customer.findMany({
                  where: { tenantId: ctx.tenant.id },
                  orderBy: { id: "asc" },
                  take: 200,
                  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                  include: { tags: { select: { tag: { select: { name: true } } } } },
                });

                if (batch.length === 0) {
                  hasMore = false;
                  break;
                }

                for (const c of batch) {
                  const line = rowToCsvLine([
                    c.name,
                    c.email,
                    c.phone ?? "",
                    c.source,
                    c.status,
                    c.visitCount,
                    (c.totalSpendCents / 100).toFixed(2),
                    c.pointsBalance,
                    c.lastVisitAt?.toISOString().slice(0, 10) ?? "",
                    c.createdAt.toISOString().slice(0, 10),
                    c.tags.map((t) => t.tag.name).join("; "),
                  ]);
                  controller.enqueue(encoder.encode(line));
                }

                cursor = batch[batch.length - 1].id;
                if (batch.length < 200) hasMore = false;
              }
              break;
            }

            case "feedback": {
              controller.enqueue(
                encoder.encode(
                  rowToCsvLine(["Date", "Customer", "Rating", "Sentiment", "Public review", "Comment"])
                )
              );

              const data = await db.feedback.findMany({
                where: { tenantId: ctx.tenant.id, createdAt: { gte: from, lte: to } },
                orderBy: { createdAt: "desc" },
                take: 1000,
                include: { customer: { select: { name: true } } },
              });

              for (const f of data) {
                const sentiment = f.rating >= 4 ? "positive" : f.rating === 3 ? "neutral" : "negative";
                controller.enqueue(
                  encoder.encode(
                    rowToCsvLine([
                      f.createdAt.toISOString().slice(0, 10),
                      f.customer?.name ?? "Anonymous",
                      f.rating,
                      sentiment,
                      f.followUpStatus === "resolved" ? "yes" : "no",
                      f.comment ?? "",
                    ])
                  )
                );
              }
              break;
            }

            case "appointments": {
              controller.enqueue(
                encoder.encode(
                  rowToCsvLine(["Date", "Customer", "Service", "Staff", "Status", "Duration (min)", "Note"])
                )
              );

              const data = await db.appointment.findMany({
                where: { tenantId: ctx.tenant.id, startAt: { gte: from, lte: to } },
                orderBy: { startAt: "asc" },
                take: 1500,
                include: {
                  customer: { select: { name: true } },
                  service: { select: { name: true } },
                  staff: { select: { name: true } },
                },
              });

              for (const a of data) {
                controller.enqueue(
                  encoder.encode(
                    rowToCsvLine([
                      a.startAt.toISOString().slice(0, 16).replace("T", " "),
                      a.customer.name,
                      a.service?.name ?? "",
                      a.staff?.name ?? "unassigned",
                      a.status,
                      a.durationMin,
                      a.note ?? "",
                    ])
                  )
                );
              }
              break;
            }

            case "campaigns": {
              controller.enqueue(
                encoder.encode(
                  rowToCsvLine(["Campaign", "Channel", "Status", "Scheduled", "Completed", "Total", "Delivered", "Read", "Failed", "Skipped"])
                )
              );

              const data = await db.campaign.findMany({
                where: { tenantId: ctx.tenant.id },
                orderBy: { createdAt: "desc" },
                include: { messages: { select: { status: true } } },
              });

              for (const c of data) {
                const delivered = c.messages.filter((m) => m.status === "delivered" || m.status === "read").length;
                const read = c.messages.filter((m) => m.status === "read").length;
                const failed = c.messages.filter((m) => m.status === "failed").length;
                const skipped = c.messages.filter((m) => m.status === "skipped").length;

                controller.enqueue(
                  encoder.encode(
                    rowToCsvLine([
                      c.name,
                      c.channel,
                      c.status,
                      c.scheduledAt?.toISOString() ?? "",
                      c.completedAt?.toISOString() ?? "",
                      c.messages.length,
                      delivered,
                      read,
                      failed,
                      skipped,
                    ])
                  )
                );
              }
              break;
            }

            case "analytics": {
              const range = { from, to };
              const [ov, ci, fb, ap, lp, cp] = await Promise.all([
                overview(ctx.tenant.id, range),
                customerIntelligence(ctx.tenant.id, range),
                feedbackTrends(ctx.tenant.id, range),
                appointmentPerformance(ctx.tenant.id, range),
                loyaltyStats(ctx.tenant.id, range),
                campaignStats(ctx.tenant.id),
              ]);

              const completedAppts = ap.byStatus.find((s) => s.status === "completed")?.count ?? 0;
              const deliveredMsgs = cp.reduce((sum, c) => sum + (c.delivered ?? 0), 0);

              const summaryRows = [
                ["Analytics summary", ctx.tenant.name, new Date().toISOString().slice(0, 10)],
                [],
                ["Metric", "Value"],
                ["Total customers", ov.kpis.customersTotal],
                ["Active customers", ov.kpis.activeCustomers],
                ["Total visits (in range)", ov.kpis.visitsInRange],
                ["Total revenue (INR)", (ov.kpis.revenueCents / 100).toFixed(2)],
                ["Average feedback rating", fb.avg ?? 0],
                ["Feedback count", fb.count],
                ["Appointments scheduled", ap.total],
                ["Appointments completed", completedAppts],
                ["Loyalty active accounts", lp.activeMembers],
                ["Loyalty points in circulation", lp.pointsIssued - lp.pointsRedeemed],
                ["Campaigns total", cp.length],
                ["Campaign messages sent", deliveredMsgs],
                [],
                ["Acquisition sources"],
                ["Source", "Customers"],
                ...ci.sources.map((s) => [s.source, s.count]),
                [],
                ["Feedback trend by month"],
                ["Month", "Average", "Count"],
                ...fb.trend.map((t) => [t.month, t.avg, t.count]),
              ];

              for (const r of summaryRows) {
                controller.enqueue(encoder.encode(rowToCsvLine(r)));
              }
              break;
            }

            default:
              controller.enqueue(encoder.encode("Error: Unknown report requested\r\n"));
              break;
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${ctx.tenant.slug}-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "transfer-encoding": "chunked",
      },
    });
  }, { name: "export", limitPerMinute: 10 })(req);
}

export const dynamic = "force-dynamic";
