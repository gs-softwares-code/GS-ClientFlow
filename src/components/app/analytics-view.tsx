"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ShieldCheck, TriangleAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiGet, downloadFile } from "@/lib/client/api";
import { formatINR, sourceLabel } from "@/lib/client/format";
import type { AppCtx } from "@/lib/client/types";

/* ---------- DTOs (mirrors of the API responses) ---------- */

type CustomersReport = {
  totalCustomers: number;
  newInRange: number;
  repeatCustomers: number;
  repeatPct: number;
  inactive: number;
  inactivePct: number;
  sources: { source: string; count: number }[];
  clvBands: { band: string; count: number }[];
  cohorts: { cohortMonth: string; size: number; returned: number; retentionPct: number }[];
  avgClvCents: number;
};

type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  segmentName: string | null;
  total: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
};
type CampaignsReport = { campaigns: CampaignRow[] };

type FeedbackReport = {
  count: number;
  avg: number | null;
  pendingReview: number;
  distribution: { rating: number; count: number }[];
  trend: { month: string; avg: number; count: number }[];
};

type AppointmentsReport = {
  total: number;
  byStatus: { status: string; count: number }[];
  completionRate: number;
  noShowRate: number;
  topServices: { service: string; count: number }[];
};

type LoyaltyReport = {
  pointsIssued: number;
  pointsRedeemed: number;
  activeMembers: number;
  avgBalance: number;
  transactionCount: number;
};

/* ---------- shared plumbing ---------- */

type TabProps = { ctx: AppCtx; from: string; to: string };

const SOURCE_PALETTE = ["#0f766e", "#ca8a04", "#be185d", "#65a30d", "#7c2d12", "#57534e"];

const QUICK_RANGES = [
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 180, label: "6m" },
  { days: 365, label: "1y" },
];

const APPT_STATUS_COLORS: Record<string, string> = {
  completed: "#059669",
  confirmed: "#ca8a04",
  booked: "#ca8a04",
  new: "#d97706",
  no_show: "#e11d48",
  cancelled: "#7c2d12",
};

/** Fetches one analytics report and exposes data/loading/error. */
function useReport<T>(path: string): { data: T | null; loading: boolean; error: string | null } {
  const { toast } = useToast();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => apiGet<T>(path))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        toast({ title: "Could not load report", description: err.message, variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, toast]);

  return { data, loading, error };
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1.5 text-xl font-semibold tabular-nums ${
          tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-700" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function KpiSkeletonRow({ count = 4, className = "grid-cols-2 lg:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={`grid gap-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[76px] rounded-xl" />
      ))}
    </div>
  );
}

function ReportError({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>Report failed to load</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function ExportButton({ label, path, filename }: { label: string; path: string; filename: string }) {
  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadFile(path, filename)}>
      <Download className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}

function campaignStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-600 bg-emerald-600/10 text-emerald-700";
    case "running":
      return "border-amber-600 bg-amber-600/10 text-amber-700";
    case "scheduled":
      return "border-amber-600 text-amber-700";
    case "failed":
      return "border-rose-600 bg-rose-600/10 text-rose-700";
    default:
      return "text-muted-foreground";
  }
}

/* ========================================================================= *
 * Customers report — KPIs, sources pie, CLV bands, cohort retention
 * ========================================================================= */

function CustomersTab({ ctx, from, to }: TabProps) {
  const { data, loading, error } = useReport<CustomersReport>(`/api/analytics?report=customers&from=${from}&to=${to}`);

  const sourcesData = useMemo(
    () =>
      (data?.sources ?? []).map((s, i) => ({
        source: sourceLabel(s.source),
        count: s.count,
        fill: SOURCE_PALETTE[i % SOURCE_PALETTE.length],
      })),
    [data]
  );

  const cohortLabel = (label: string): string => {
    const c = (data?.cohorts ?? []).find((x) => x.cohortMonth === label);
    return c ? `${label} — ${c.size} joined, ${c.returned} returned` : label;
  };

  const sourcesConfig: ChartConfig = { count: { label: "Customers" } };
  const clvConfig: ChartConfig = { count: { label: "Customers", color: "var(--brand)" } };
  const cohortConfig: ChartConfig = { retentionPct: { label: "Retention %", color: "#0f766e" } };

  if (error && !data) return <ReportError error={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Acquisition, lifetime value and retention of the customer base</p>
        <ExportButton label="Export customers" path="/api/export/customers" filename={`${ctx.tenant.slug}-customers.csv`} />
      </div>

      {!data ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total customers" value={String(data.totalCustomers)} sub={`${data.newInRange} new in range`} />
          <Kpi label="Repeat rate" value={`${data.repeatPct}%`} sub={`${data.repeatCustomers} repeat customers`} tone="good" />
          <Kpi
            label="Inactive"
            value={String(data.inactive)}
            sub={`${data.inactivePct}% of the base`}
            tone={data.inactivePct > 40 ? "warn" : undefined}
          />
          <Kpi label="Avg CLV" value={formatINR(data.avgClvCents)} sub="Lifetime spend per customer" />
        </div>
      )}

      {loading && !data ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Acquisition sources</CardTitle>
              <CardDescription>How customers found this business</CardDescription>
            </CardHeader>
            <CardContent>
              {sourcesData.length ? (
                <>
                  <ChartContainer config={sourcesConfig} className="h-40 w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie data={sourcesData} dataKey="count" nameKey="source" innerRadius={32} outerRadius={60} paddingAngle={3}>
                        {sourcesData.map((_, i) => (
                          <Cell key={i} fill={SOURCE_PALETTE[i % SOURCE_PALETTE.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {sourcesData.map((s) => (
                      <span key={s.source} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.fill }} />
                        {s.source} · {s.count}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyNote text="No customers yet — sources appear once registrations exist." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lifetime value bands</CardTitle>
              <CardDescription>Customers grouped by lifetime spend</CardDescription>
            </CardHeader>
            <CardContent>
              {data && data.clvBands.length ? (
                <ChartContainer config={clvConfig} className="h-40 w-full">
                  <BarChart data={data.clvBands} margin={{ right: 12 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="band" tickLine={false} axisLine={false} tickMargin={8} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : data ? (
                <EmptyNote text="No spend recorded yet." />
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cohort retention</CardTitle>
              <CardDescription>Share of each monthly cohort that came back</CardDescription>
            </CardHeader>
            <CardContent>
              {data && data.cohorts.length ? (
                <ChartContainer config={cohortConfig} className="h-40 w-full">
                  <BarChart data={data.cohorts} margin={{ right: 12 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="cohortMonth" tickLine={false} axisLine={false} tickMargin={8} fontSize={10} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={34} fontSize={11} unit="%" />
                    <ChartTooltip
                      content={<ChartTooltipContent labelFormatter={(l) => <div className="font-medium">{cohortLabel(String(l))}</div>} />}
                    />
                    <Bar dataKey="retentionPct" fill="var(--color-retentionPct)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : data ? (
                <EmptyNote text="No cohorts yet — they build up month by month." />
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= *
 * Campaigns report — delivery / read performance table
 * ========================================================================= */

function CampaignsTab({ ctx }: TabProps) {
  const { data, error } = useReport<CampaignsReport>("/api/analytics?report=campaigns");

  if (error && !data) return <ReportError error={error} />;

  const rows = data?.campaigns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Delivery and read performance of every campaign</p>
        <ExportButton label="Export campaigns" path="/api/export/campaigns" filename={`${ctx.tenant.slug}-campaigns.csv`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Campaign performance</CardTitle>
          <CardDescription>{data ? `${rows.length} campaigns with audience, delivery and read outcomes` : "Loading campaigns…"}</CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-48 w-full" />
          ) : rows.length ? (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block max-h-[420px] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Segment</TableHead>
                      <TableHead className="text-right">Audience</TableHead>
                      <TableHead className="w-[120px]">Delivery</TableHead>
                      <TableHead className="w-[120px]">Read</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Skipped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => {
                      const deliveryPct = c.total > 0 ? Math.round((c.delivered / c.total) * 100) : 0;
                      const readPct = c.delivered > 0 ? Math.round((c.read / c.delivered) * 100) : 0;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] capitalize">
                              {c.channel}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] capitalize ${campaignStatusClass(c.status)}`}>
                              {c.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{c.segmentName ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.total}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Progress value={deliveryPct} className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]" />
                              <p className="text-[10px] text-muted-foreground">
                                {deliveryPct}% of {c.total}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Progress value={readPct} className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]" />
                              <p className="text-[10px] text-muted-foreground">{readPct}% of delivered</p>
                            </div>
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${c.failed > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                            {c.failed}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{c.skipped}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card Stack */}
              <div className="block md:hidden space-y-2.5 max-h-[420px] overflow-y-auto">
                {rows.map((c) => {
                  const deliveryPct = c.total > 0 ? Math.round((c.delivered / c.total) * 100) : 0;
                  const readPct = c.delivered > 0 ? Math.round((c.read / c.delivered) * 100) : 0;
                  return (
                    <Card key={`m-${c.id}`} className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{c.name}</span>
                        <Badge variant="outline" className={`text-[10px] capitalize shrink-0 ${campaignStatusClass(c.status)}`}>
                          {c.status}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {c.channel}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {c.segmentName ?? "All customers"} · {c.total} audience
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t text-xs">
                        <div>
                          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                            <span>Delivered</span>
                            <span className="font-medium text-foreground">{deliveryPct}%</span>
                          </div>
                          <Progress value={deliveryPct} className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]" />
                        </div>
                        <div>
                          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                            <span>Read</span>
                            <span className="font-medium text-foreground">{readPct}%</span>
                          </div>
                          <Progress value={readPct} className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
                        <span className={c.failed > 0 ? "text-rose-600 font-medium" : ""}>
                          {c.failed} failed
                        </span>
                        <span>{c.skipped} skipped</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyNote text="No campaigns yet — schedule one from Campaigns & Offers." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ========================================================================= *
 * Feedback report — avg/count KPIs, distribution bars, trend line
 * ========================================================================= */

function FeedbackTab({ ctx, from, to }: TabProps) {
  const { data, error } = useReport<FeedbackReport>(`/api/analytics?report=feedback&from=${from}&to=${to}`);

  const distConfig: ChartConfig = { count: { label: "Responses", color: "#ca8a04" } };
  const trendConfig: ChartConfig = { avg: { label: "Avg rating", color: "var(--brand)" } };

  const distribution = useMemo(
    () => (data?.distribution ?? []).map((d) => ({ rating: String(d.rating), count: d.count })),
    [data]
  );

  if (error && !data) return <ReportError error={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Satisfaction signal for the selected range</p>
        <ExportButton label="Export feedback" path="/api/export/feedback" filename={`${ctx.tenant.slug}-feedback.csv`} />
      </div>

      {!data ? (
        <KpiSkeletonRow count={3} className="grid-cols-2 sm:grid-cols-3" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Average rating" value={data.avg !== null ? `${data.avg} / 5` : "—"} sub={`${data.count} responses`} />
          <Kpi label="Responses" value={String(data.count)} sub="in the selected range" />
          <Kpi
            label="Pending review"
            value={String(data.pendingReview)}
            sub={data.pendingReview > 0 ? "awaiting staff action" : "all caught up"}
            tone={data.pendingReview > 0 ? "warn" : "good"}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Rating distribution</CardTitle>
            <CardDescription>Responses per star, 1 to 5</CardDescription>
          </CardHeader>
          <CardContent>
            {data && distribution.length ? (
              <ChartContainer config={distConfig} className="h-44 w-full">
                <BarChart data={distribution} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="rating" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : data ? (
              <EmptyNote text="No feedback in this range yet." />
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Rating trend</CardTitle>
            <CardDescription>Average rating by month with volume</CardDescription>
          </CardHeader>
          <CardContent>
            {data && data.trend.length ? (
              <ChartContainer config={trendConfig} className="h-44 w-full">
                <LineChart data={data.trend} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis domain={[1, 5]} tickLine={false} axisLine={false} width={30} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="avg" type="monotone" stroke="var(--color-avg)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            ) : data ? (
              <EmptyNote text="Not enough history for a trend yet." />
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ========================================================================= *
 * Appointments report — completion / no-show, status mix, top services
 * ========================================================================= */

function AppointmentsTab({ ctx }: TabProps) {
  const { data, error } = useReport<AppointmentsReport>("/api/analytics?report=appointments");

  const statusConfig: ChartConfig = { count: { label: "Appointments", color: "var(--brand)" } };

  if (error && !data) return <ReportError error={error} />;

  const top = data?.topServices ?? [];
  const maxCount = top.length ? Math.max(...top.map((s) => s.count)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Booking outcomes across the appointment calendar</p>
        <ExportButton label="Export appointments" path="/api/export/appointments" filename={`${ctx.tenant.slug}-appointments.csv`} />
      </div>

      {!data ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total appointments" value={String(data.total)} sub="all time" />
          <Kpi label="Completion rate" value={`${data.completionRate}%`} sub="completed of total" tone="good" />
          <Kpi label="No-show rate" value={`${data.noShowRate}%`} sub="missed without cancelling" tone={data.noShowRate > 10 ? "bad" : "warn"} />
          <Kpi label="Top service" value={top[0]?.service ?? "—"} sub={top[0] ? `${top[0].count} bookings` : "no bookings yet"} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status mix</CardTitle>
            <CardDescription>Appointments by current status</CardDescription>
          </CardHeader>
          <CardContent>
            {data && data.byStatus.length ? (
              <ChartContainer config={statusConfig} className="h-44 w-full">
                <BarChart data={data.byStatus} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} tickMargin={8} fontSize={10} tickFormatter={(v: string) => sourceLabel(v)} />
                  <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.byStatus.map((s) => (
                      <Cell key={s.status} fill={APPT_STATUS_COLORS[s.status] ?? "#57534e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : data ? (
              <EmptyNote text="No appointments recorded yet." />
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top services</CardTitle>
            <CardDescription>Most-booked services, relative to the leader</CardDescription>
          </CardHeader>
          <CardContent>
            {data && top.length ? (
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {top.map((s) => (
                  <div key={s.service} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{s.service}</span>
                      <span className="tabular-nums text-muted-foreground">{s.count}</span>
                    </div>
                    <Progress
                      value={maxCount > 0 ? Math.round((s.count / maxCount) * 100) : 0}
                      className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]"
                    />
                  </div>
                ))}
              </div>
            ) : data ? (
              <EmptyNote text="No service bookings yet." />
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ========================================================================= *
 * Loyalty report — points economy KPIs
 * ========================================================================= */

function LoyaltyTab({ ctx }: TabProps) {
  const { data, error } = useReport<LoyaltyReport>("/api/analytics?report=loyalty");

  if (error && !data) return <ReportError error={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">The points economy of this business</p>
        <ExportButton label="Export loyalty" path="/api/export/loyalty" filename={`${ctx.tenant.slug}-loyalty.csv`} />
      </div>

      {!data ? (
        <KpiSkeletonRow count={5} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Points issued" value={data.pointsIssued.toLocaleString()} sub="all-time credits" />
          <Kpi label="Points redeemed" value={data.pointsRedeemed.toLocaleString()} sub="all-time debits" />
          <Kpi label="Active members" value={data.activeMembers.toLocaleString()} sub="customers with a balance" />
          <Kpi label="Avg balance" value={data.avgBalance.toLocaleString()} sub="points per member" />
          <Kpi label="Transactions" value={data.transactionCount.toLocaleString()} sub="ledger entries" />
        </div>
      )}

      <Alert>
        <ShieldCheck />
        <AlertTitle>Points ledger integrity</AlertTitle>
        <AlertDescription>
          Points ledger integrity is enforced by unique idempotency keys — duplicate credits and double redemptions are rejected at the storage
          layer, inside the same transaction that moves the balance.
        </AlertDescription>
      </Alert>
    </div>
  );
}

/* ========================================================================= *
 * Main view — header, date controls, tab shell
 * ========================================================================= */

export default function AnalyticsView({ ctx }: { ctx: AppCtx }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(() => new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const modules = ctx.tenant.settings.modules;

  const applyRange = (days: number) => {
    setFrom(new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10));
    setTo(today);
  };
  const isActiveRange = (days: number) =>
    from === new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10) && to === today;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Computed live from this business&apos;s data — no fabricated metrics</p>
      </div>

      {/* Date controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-[136px] text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[136px] text-xs" />
        </div>
        <div className="flex items-center gap-1.5">
          {QUICK_RANGES.map((r) => (
            <Badge
              key={r.label}
              role="button"
              tabIndex={0}
              aria-pressed={isActiveRange(r.days)}
              variant={isActiveRange(r.days) ? "default" : "outline"}
              className={`cursor-pointer select-none px-2.5 py-1 text-xs ${
                isActiveRange(r.days) ? "border-transparent bg-[var(--brand)] text-white" : "text-muted-foreground hover:bg-accent"
              }`}
              onClick={() => applyRange(r.days)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  applyRange(r.days);
                }
              }}
            >
              {r.label}
            </Badge>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => downloadFile(`/api/export/analytics-summary?from=${from}&to=${to}`, `analytics-${ctx.tenant.slug}.csv`)}
        >
          <Download className="h-3.5 w-3.5" /> Export summary
        </Button>
      </div>

      <Tabs defaultValue="customers">
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
          <TabsTrigger value="customers" className="shrink-0 px-3">
            Customers
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="shrink-0 px-3">
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="feedback" className="shrink-0 px-3">
            Feedback
          </TabsTrigger>
          {modules.appointments && (
            <TabsTrigger value="appointments" className="shrink-0 px-3">
              Appointments
            </TabsTrigger>
          )}
          {modules.loyalty && (
            <TabsTrigger value="loyalty" className="shrink-0 px-3">
              Loyalty
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="customers" className="pt-2">
          <CustomersTab ctx={ctx} from={from} to={to} />
        </TabsContent>
        <TabsContent value="campaigns" className="pt-2">
          <CampaignsTab ctx={ctx} from={from} to={to} />
        </TabsContent>
        <TabsContent value="feedback" className="pt-2">
          <FeedbackTab ctx={ctx} from={from} to={to} />
        </TabsContent>
        {modules.appointments && (
          <TabsContent value="appointments" className="pt-2">
            <AppointmentsTab ctx={ctx} from={from} to={to} />
          </TabsContent>
        )}
        {modules.loyalty && (
          <TabsContent value="loyalty" className="pt-2">
            <LoyaltyTab ctx={ctx} from={from} to={to} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
