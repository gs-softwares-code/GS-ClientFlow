"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, IndianRupee, Star, Repeat, CalendarHeart, Zap, ArrowUpRight, Megaphone } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/client/api";
import { formatINR, timeAgo, sourceLabel } from "@/lib/client/format";
import type { AppCtx } from "@/lib/client/types";

type Overview = {
  kpis: {
    customersTotal: number; activeCustomers: number; newInRange: number; visitsInRange: number;
    distinctVisitors: number; revenueCents: number; avgTicketCents: number;
    feedbackAvg: number | null; feedbackCount: number; redemptions: number; upcomingBirthdays: number;
  };
  growthSeries: { month: string; newCustomers: number; cumulative: number }[];
  visitSeries: { month: string; visits: number; revenueCents: number }[];
  feedbackSeries: { month: string; avg: number; count: number }[];
  messageStatuses: { status: string; count: number }[];
  upcomingBirthdays: { id: string; name: string; inDays: number; date: string }[];
};

type EventsFeed = {
  events: { id: string; type: string; status: string; attempts: number; createdAt: string; lastError: string | null }[];
  counts: { status: string; count: number }[];
};

const RANGES = [
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 6 months" },
  { id: "365", label: "Last year" },
];

export function DashboardView({ ctx }: { ctx: AppCtx }) {
  const [days, setDays] = useState("90");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - Number(days) * 86400_000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const [o, e] = await Promise.all([
        apiGet<Overview>(`/api/analytics?report=overview&from=${from}&to=${to}`),
        apiGet<EventsFeed>("/api/events?limit=8"),
      ]);
      setOverview(o);
      setEvents(e);
    } catch (err) {
      toast({ title: "Could not load dashboard", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const runWorkerTick = async () => {
    try {
      const res = await apiPost<{ message: string }>("/api/ops", { action: "tick" });
      toast({ title: "Worker tick executed", description: res.message });
      void load();
    } catch (err) {
      toast({ title: "Tick failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const kpis = overview?.kpis;

  const growthConfig: ChartConfig = { cumulative: { label: "Total customers", color: "var(--brand)" }, newCustomers: { label: "New", color: "var(--chart-2)" } };
  const visitConfig: ChartConfig = { revenue: { label: "Revenue (₹k)", color: "var(--brand)" } };
  const feedbackConfig: ChartConfig = { avg: { label: "Avg rating", color: "#ca8a04" } };

  const revenueSeries = useMemo(
    () => overview?.visitSeries.map((v) => ({ month: v.month.slice(5), revenue: Math.round(v.revenueCents / 100000) })) ?? [],
    [overview]
  );
  const pieData = useMemo(
    () =>
      (overview?.messageStatuses ?? []).map((m) => ({ status: m.status, count: m.count })),
    [overview]
  );
  const PIE_COLORS = ["#0f766e", "#ca8a04", "#be185d", "#b91c1c", "#737373"];

  return (
    <div className="space-y-6">
      {/* Range + worker controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
          <Zap className="h-3 w-3" /> computed live from this business&apos;s data
        </Badge>
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={runWorkerTick}>
          <ArrowUpRight className="h-3.5 w-3.5" /> Run worker tick now
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Customers", value: kpis ? String(kpis.customersTotal) : "—", sub: kpis ? `${kpis.newInRange} new in range` : "", icon: Users },
          { label: "Revenue (range)", value: kpis ? formatINR(kpis.revenueCents) : "—", sub: kpis ? `${kpis.visitsInRange} visits · avg ${formatINR(kpis.avgTicketCents)}` : "", icon: IndianRupee },
          { label: "Feedback", value: kpis && kpis.feedbackAvg ? `${kpis.feedbackAvg} / 5` : "—", sub: kpis ? `${kpis.feedbackCount} responses` : "", icon: Star },
          { label: "Repeat visitors", value: kpis ? String(kpis.distinctVisitors) : "—", sub: kpis ? `${kpis.redemptions} offer redemptions` : "", icon: Repeat },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <k.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
            </div>
            <div className="mt-1.5 text-xl font-semibold tabular-nums">{loading && !kpis ? <Skeleton className="h-7 w-20" /> : k.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{k.sub}</div>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer growth</CardTitle>
            <CardDescription>New customers by month with running total</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={growthConfig} className="h-52 w-full">
              <AreaChart data={overview?.growthSeries ?? []} margin={{ left: 0, right: 12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={32} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="cumulative" type="monotone" fill="var(--color-cumulative)" stroke="var(--color-cumulative)" fillOpacity={0.12} strokeWidth={2} />
                <Area dataKey="newCustomers" type="monotone" fill="var(--color-newCustomers)" stroke="var(--color-newCustomers)" fillOpacity={0.25} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Message delivery</CardTitle>
            <CardDescription>Outbox-processed sends by status</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length ? (
              <ChartContainer config={{ status: { label: "Status" } }} className="h-52 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie data={pieData} dataKey="count" nameKey="status" innerRadius={38} outerRadius={70} paddingAngle={3}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <Skeleton className="h-52 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue by month</CardTitle>
            <CardDescription>Visit revenue (₹ thousands)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={visitConfig} className="h-44 w-full">
              <BarChart data={revenueSeries} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={32} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Feedback trend</CardTitle>
            <CardDescription>Average rating by month</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={feedbackConfig} className="h-44 w-full">
              <LineChart data={overview?.feedbackSeries ?? []} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis domain={[1, 5]} tickLine={false} axisLine={false} width={32} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="avg" type="monotone" stroke="var(--color-avg)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Birthdays + recent events */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarHeart className="h-4 w-4 text-[var(--brand)]" /> Upcoming birthdays
            </CardTitle>
            <CardDescription>
              Date-trigger scheduler fires automatically {ctx.tenant.settings.birthdayLeadDays} days ahead — wishes + birthday offer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(overview?.upcomingBirthdays ?? []).length ? (
              overview!.upcomingBirthdays.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{b.date}</span>
                    <Badge variant={b.inDays <= ctx.tenant.settings.birthdayLeadDays ? "default" : "secondary"} className="text-[10px]">
                      in {b.inDays}d
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground py-6 text-center">No birthdays in the next two weeks.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-[var(--brand)]" /> Recent events (outbox)
            </CardTitle>
            <CardDescription>Transactional events processed by the automation worker</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {(events?.events ?? []).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2">
                <span className="font-mono text-[10px] truncate">{e.type}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {e.attempts > 1 && <span className="text-[10px] text-muted-foreground">{e.attempts} tries</span>}
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${
                      e.status === "done" ? "border-emerald-600 text-emerald-700" :
                      e.status === "dead" ? "border-destructive text-destructive" :
                      e.status === "pending" ? "border-amber-600 text-amber-700" : ""
                    }`}
                  >
                    {e.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground w-12 text-right">{timeAgo(e.createdAt)}</span>
                </span>
              </div>
            ))}
            {!events?.events.length && <div className="text-sm text-muted-foreground py-6 text-center">Queue is idle.</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
