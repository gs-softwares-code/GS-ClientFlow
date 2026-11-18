"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Dumbbell,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  ListChecks,
  PhoneCall,
  Play,
  RefreshCw,
  ScanSearch,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost } from "@/lib/client/api";
import { formatDate, formatDateTime, formatINR, timeAgo } from "@/lib/client/format";
import type { AppCtx, AttendanceLog, StaffFollowUpTask, Membership } from "@/lib/client/types";

/* ---------- DTOs (mirrors of the API responses) ---------- */

type OpsSnapshot = {
  worker: {
    startedAt: string | null;
    ticks: number;
    processed: number;
    failed: number;
    dead: number;
    retried: number;
    scheduledRun: number;
    lastTickAt: string | null;
    lastError: string | null;
    running: boolean;
  };
  queue: {
    tenant: { status: string; count: number }[];
    global: { status: string; count: number }[];
    deadLetterGlobal: number;
  };
  scheduled: {
    counts: { status: string; count: number }[];
    dueNow: number;
    nextDue: string | null;
    upcoming: { id: string; kind: string; dueAt: string; payload: Record<string, string> }[];
  };
  rateLimits: {
    total429: number;
    recent: { key: string; at: string }[];
  };
  usage: {
    plan: string;
    metrics: { metric: string; today: number; last30d: number; limit: number; limitLabel: string; window: string; pct: number }[];
  } | null;
  storage: { table: string; rows: number }[];
  logs: {
    id: string;
    level: string;
    scope: string;
    message: string;
    meta: Record<string, unknown> | null;
    tenantId: string | null;
    createdAt: string;
  }[];
};

type SecurityTests = {
  results: { name: string; passed: boolean; detail: string }[];
  passed: number;
  total: number;
  allPassed: boolean;
};

/* ---------- helpers ---------- */

function uptime(startedAt: string | null): string {
  if (!startedAt) return "—";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "just started";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function queueBadgeClass(status: string): string {
  switch (status) {
    case "pending":
      return "border-amber-600 bg-amber-600/10 text-amber-700";
    case "processing":
      return "border-amber-600 text-amber-700";
    case "done":
      return "border-emerald-600 bg-emerald-600/10 text-emerald-700";
    case "dead":
      return "border-rose-600 bg-rose-600/10 text-rose-700";
    default:
      return "";
  }
}

function logBadge(level: string): { variant: "secondary" | "outline"; className: string } {
  if (level === "warn") return { variant: "outline", className: "border-amber-600 bg-amber-600/10 text-amber-700 capitalize" };
  if (level === "error") return { variant: "outline", className: "border-rose-600 bg-rose-600/10 text-rose-700 capitalize" };
  return { variant: "secondary", className: "capitalize" };
}

const GUARD_POINTS = [
  "Sessions are server-side bound to exactly one tenant.",
  "The API guard resolves the tenant from the session only — never from client input.",
  "Every service query is tenant-scoped by construction.",
  "Public endpoints resolve the tenant by slug and rate-limit by IP.",
];

/* ========================================================================= *
 * Ops & Security — live runtime health of the automation core
 * ========================================================================= */

export default function OpsView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [snap, setSnap] = useState<OpsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState<"tick" | "scan" | null>(null);
  const [tests, setTests] = useState<SecurityTests | null>(null);
  const [testsRunning, setTestsRunning] = useState(false);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<OpsSnapshot>("/api/ops");
      setSnap(res);
      setError(null);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (firstLoad.current) {
        toast({ title: "Could not load ops snapshot", description: message, variant: "destructive" });
      }
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh polls GET /api/ops every 15 seconds while enabled.
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [auto, load]);

  const runAction = async (action: "tick" | "scan") => {
    setBusy(action);
    try {
      const res = await apiPost<{ message: string }>("/api/ops", { action });
      toast({
        title: action === "tick" ? "Worker tick executed" : "Scheduler scan executed",
        description: res.message,
      });
      await load();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runTests = async () => {
    setTestsRunning(true);
    try {
      const res = await apiGet<SecurityTests>("/api/ops/security-tests");
      setTests(res);
      toast({
        title: res.allPassed ? "All isolation probes passed" : "Isolation probes finished with failures",
        description: `${res.passed}/${res.total} cross-tenant probes passed for ${ctx.tenant.name}.`,
        variant: res.allPassed ? undefined : "destructive",
      });
    } catch (err) {
      toast({ title: "Could not run security tests", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTestsRunning(false);
    }
  };

  const w = snap?.worker;
  const stats: { label: string; value: string; tone?: "warn" | "bad" }[] = w
    ? [
        { label: "Ticks", value: String(w.ticks) },
        { label: "Processed", value: String(w.processed) },
        { label: "Failed", value: String(w.failed), tone: w.failed > 0 ? "bad" : undefined },
        { label: "Dead-lettered", value: String(w.dead), tone: w.dead > 0 ? "bad" : undefined },
        { label: "Retried", value: String(w.retried), tone: w.retried > 0 ? "warn" : undefined },
        { label: "Scheduled actions run", value: String(w.scheduledRun) },
        { label: "Uptime", value: uptime(w.startedAt) },
        { label: "Last tick", value: timeAgo(w.lastTickAt) },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Header + auto-refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ops &amp; Security</h1>
          <p className="text-sm text-muted-foreground">Runtime health of the automation core</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${snap?.worker.running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`} />
            worker {snap?.worker.running ? "running" : "idle"}
          </Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load()} aria-label="Refresh now">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto refresh every 15 seconds" />
            Auto-refresh 15s
          </label>
        </div>
      </div>

      {error && !snap && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Ops snapshot unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!snap ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <Tabs defaultValue="worker">
          <TabsList className="h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
            <TabsTrigger value="worker" className="shrink-0 px-3">
              Worker &amp; queue
            </TabsTrigger>
            <TabsTrigger value="attendance" className="shrink-0 px-3 flex items-center gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" /> Attendance Desk
            </TabsTrigger>
            <TabsTrigger value="memberships" className="shrink-0 px-3 flex items-center gap-1.5">
              <Dumbbell className="h-3.5 w-3.5" /> Membership Ledger
            </TabsTrigger>
            <TabsTrigger value="security" className="shrink-0 px-3">
              Security tests
            </TabsTrigger>
            <TabsTrigger value="usage" className="shrink-0 px-3">
              Usage &amp; limits
            </TabsTrigger>
            <TabsTrigger value="logs" className="shrink-0 px-3">
              Logs
            </TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------ Worker & queue */}
          <TabsContent value="worker" className="space-y-4 pt-2">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cpu className="h-4 w-4 text-[var(--brand)]" /> Worker
                  </CardTitle>
                  <CardDescription>In-process consumer with the same semantics as the production queue consumer</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {stats.map((s) => (
                      <div key={s.label} className="rounded-lg border p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                        <div
                          className={`mt-1 text-lg font-semibold tabular-nums ${
                            s.tone === "bad" ? "text-rose-600" : s.tone === "warn" ? "text-amber-600" : ""
                          }`}
                        >
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {snap.worker.lastError && (
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertTitle>Last worker error</AlertTitle>
                      <AlertDescription className="break-all font-mono text-xs">{snap.worker.lastError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1.5" onClick={() => void runAction("tick")} disabled={busy !== null}>
                      <Zap className="h-3.5 w-3.5" />
                      {busy === "tick" ? "Running…" : "Run worker tick"}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runAction("scan")} disabled={busy !== null}>
                      <ScanSearch className="h-3.5 w-3.5" />
                      {busy === "scan" ? "Scanning…" : "Run scheduler scan"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecks className="h-4 w-4 text-[var(--brand)]" /> Outbox queue
                  </CardTitle>
                  <CardDescription>
                    Transactional outbox — events are claimed with a lease, retried with exponential backoff (3s→5min), and dead-lettered after
                    5 attempts. Retry-able from the Automation view.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {snap.queue.tenant.length ? (
                      snap.queue.tenant.map((q) => (
                        <Badge key={q.status} variant="outline" className={`capitalize ${queueBadgeClass(q.status)}`}>
                          {q.status} · {q.count}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">This tenant&apos;s queue is empty.</span>
                    )}
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Global dead-letter total</span>
                      <Badge
                        variant="outline"
                        className={
                          snap.queue.deadLetterGlobal > 0 ? "border-rose-600 bg-rose-600/10 text-rose-700" : "border-emerald-600 bg-emerald-600/10 text-emerald-700"
                        }
                      >
                        {snap.queue.deadLetterGlobal} events
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                      global: {snap.queue.global.map((g) => `${g.status} ${g.count}`).join(" · ") || "empty"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-4 w-4 text-[var(--brand)]" /> Scheduled actions
                  </CardTitle>
                  <CardDescription>Date-triggered jobs materialized from workflow definitions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={snap.scheduled.dueNow > 0 ? "border-amber-600 bg-amber-600/10 text-amber-700" : ""}>
                      due now: {snap.scheduled.dueNow}
                    </Badge>
                    {snap.scheduled.counts.map((c) => (
                      <Badge key={c.status} variant="outline" className={`capitalize ${queueBadgeClass(c.status)}`}>
                        {c.status} · {c.count}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">next due {formatDateTime(snap.scheduled.nextDue)}</span>
                  </div>
                  <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                    {snap.scheduled.upcoming.length ? (
                      snap.scheduled.upcoming.map((u) => (
                        <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {u.kind}
                          </Badge>
                          <span className="shrink-0 text-muted-foreground">{formatDateTime(u.dueAt)}</span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {Object.keys(u.payload ?? {}).join(" · ") || "—"}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                        Nothing scheduled — the scanner materializes actions as due dates approach.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4 text-[var(--brand)]" /> Storage
                  </CardTitle>
                  <CardDescription>Tenant-scoped row counts (SQLite file in this sandbox; Neon storage metrics in production)</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.storage.map((s) => (
                        <TableRow key={s.table}>
                          <TableCell className="font-mono text-xs">{s.table}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.rows.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ------------------------------------------------------ Attendance Desk (Coaching Vertical) */}
          <TabsContent value="attendance" className="space-y-4 pt-2">
            <AttendanceDeskTab ctx={ctx} />
          </TabsContent>

          {/* ------------------------------------------------------ Membership Ledger (Gym Vertical) */}
          <TabsContent value="memberships" className="space-y-4 pt-2">
            <MembershipLedgerTab ctx={ctx} />
          </TabsContent>

          {/* ------------------------------------------------------ Security tests */}
          <TabsContent value="security" className="space-y-4 pt-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-[var(--brand)]" /> Tenant isolation test runner
                </CardTitle>
                <CardDescription>Executes cross-tenant access probes against the real data-access layer</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" className="gap-1.5" onClick={() => void runTests()} disabled={testsRunning}>
                    {testsRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    {testsRunning ? "Running probes…" : "Run tests"}
                  </Button>
                  {tests && (
                    <Badge
                      variant="outline"
                      className={
                        tests.allPassed ? "border-emerald-600 bg-emerald-600/10 text-emerald-700" : "border-rose-600 bg-rose-600/10 text-rose-700"
                      }
                    >
                      {tests.passed}/{tests.total} passed
                    </Badge>
                  )}
                </div>
                {tests ? (
                  <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                    {tests.results.map((r) => (
                      <div key={r.name} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            r.passed ? "border-emerald-600 bg-emerald-600/10 text-emerald-700" : "border-rose-600 bg-rose-600/10 text-rose-700"
                          }`}
                        >
                          {r.passed ? "PASS" : "FAIL"}
                        </Badge>
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{r.name}</div>
                          <div className="break-words text-xs text-muted-foreground">{r.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                    Run the probes to verify tenant isolation end-to-end — results stay on screen until the next run.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Session &amp; guard</CardTitle>
                <CardDescription>How every request stays inside one tenant</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {GUARD_POINTS.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------ Usage & limits */}
          <TabsContent value="usage" className="space-y-4 pt-2">
            {snap.usage ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="h-4 w-4 text-[var(--brand)]" /> Usage &amp; plan limits
                  </CardTitle>
                  <CardDescription>Current consumption against this tenant&apos;s quotas</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant="secondary">{snap.usage.plan} plan</Badge>
                  {snap.usage.metrics.map((m) => {
                    const current = m.metric.toLowerCase().includes("request") ? m.today : m.last30d;
                    const pct = Math.min(100, Math.max(0, Math.round(m.pct)));
                    const barClass = pct > 90 ? "[&>div]:bg-rose-600" : pct > 70 ? "[&>div]:bg-amber-600" : "";
                    return (
                      <div key={m.metric} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium capitalize">{m.metric}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {m.window}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            <span className="font-mono font-semibold tabular-nums text-foreground">{current.toLocaleString()}</span> current ·
                            limit {m.limitLabel}
                          </span>
                          <span className="tabular-nums">{pct}% used</span>
                        </div>
                        <Progress value={pct} className={`mt-2 h-1.5 ${barClass}`} />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">No usage snapshot available for this tenant.</CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Rate limiting</CardTitle>
                <CardDescription>Token-bucket limiter, scoped per tenant+route so one noisy tenant cannot starve another.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-xs text-muted-foreground">Requests rejected with 429 (total)</span>
                  <Badge
                    variant="outline"
                    className={
                      snap.rateLimits.total429 > 0 ? "border-amber-600 bg-amber-600/10 text-amber-700" : "border-emerald-600 bg-emerald-600/10 text-emerald-700"
                    }
                  >
                    {snap.rateLimits.total429}
                  </Badge>
                </div>
                <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
                  {snap.rateLimits.recent.length ? (
                    snap.rateLimits.recent.map((r, i) => (
                      <div key={`${r.key}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs">
                        <span className="truncate font-mono text-[10px]">{r.key}</span>
                        <span className="shrink-0 text-muted-foreground">{timeAgo(r.at)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-sm text-muted-foreground">No rate-limited keys yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------ Logs */}
          <TabsContent value="logs" className="pt-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScrollText className="h-4 w-4 text-[var(--brand)]" /> Structured logs
                </CardTitle>
                <CardDescription>
                  SystemLog table surfaced in-app for {ctx.tenant.slug} and platform scope — auto-refresh keeps this feed live
                </CardDescription>
              </CardHeader>
              <CardContent>
                {snap.logs.length ? (
                  <div className="max-h-[480px] overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Level</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead>Tenant</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {snap.logs.map((l) => {
                          const badge = logBadge(l.level);
                          return (
                            <TableRow key={l.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</TableCell>
                              <TableCell>
                                <Badge variant={badge.variant} className={`text-[10px] ${badge.className}`}>
                                  {l.level}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-[10px]">{l.scope}</TableCell>
                              <TableCell
                                className="max-w-[280px] whitespace-normal text-xs line-clamp-2"
                                title={l.meta ? JSON.stringify(l.meta) : undefined}
                              >
                                {l.message}
                              </TableCell>
                              <TableCell className="font-mono text-[10px] text-muted-foreground">{l.tenantId ? l.tenantId.slice(0, 8) : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    No log lines yet — worker actions and API traffic will appear here.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Attendance Desk & Follow-Up Call Queue (Coaching Vertical)                */
/* ------------------------------------------------------------------------- */

function AttendanceDeskTab({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batch, setBatch] = useState("JEE-2027");
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [tasks, setTasks] = useState<StaffFollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ logs: AttendanceLog[]; tasks: StaffFollowUpTask[] }>(
        `/api/attendance?date=${encodeURIComponent(date)}&batchOrClass=${encodeURIComponent(batch)}&includeTasks=true`
      );
      setLogs(res.logs ?? []);
      setTasks(res.tasks ?? []);
    } catch (err) {
      toast({ title: "Failed to load attendance", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [date, batch, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleMark = async (logId: string, customerId: string, status: "PRESENT" | "ABSENT" | "LATE", guardianPhone: string) => {
    setMarkingId(customerId);
    try {
      await apiPost("/api/attendance", {
        action: "mark",
        customerId,
        batchOrClass: batch,
        date,
        status,
        guardianPhone,
      });
      toast({
        title: `Marked as ${status}`,
        description: status === "ABSENT" ? "Parent alert dispatched with 60-min reply window." : "Attendance logged.",
      });
      await loadData();
    } catch (err) {
      toast({ title: "Could not mark attendance", description: (err as Error).message, variant: "destructive" });
    } finally {
      setMarkingId(null);
    }
  };

  const handleResolveTask = async (taskId: string) => {
    setResolvingId(taskId);
    try {
      await apiPost("/api/attendance", {
        action: "resolve_task",
        taskId,
        notes: "Guardian reached via telephone call. Absence validated.",
      });
      toast({ title: "Escalation Call Resolved", description: "Task closed and audit event recorded." });
      await loadData();
    } catch (err) {
      toast({ title: "Failed to resolve task", description: (err as Error).message, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const presentCount = logs.filter((l) => l.status === "PRESENT").length;
  const absentCount = logs.filter((l) => l.status === "ABSENT").length;
  const unrepliedCount = logs.filter((l) => l.status === "ABSENT" && (l.guardianReplyStatus === "NO_REPLY" || l.guardianReplyStatus === "PENDING")).length;

  return (
    <div className="space-y-4">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <Label htmlFor="att-date" className="text-xs">Roster Date</Label>
            <Input id="att-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="att-batch" className="text-xs">Class / Batch</Label>
            <Input id="att-batch" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. JEE-2027" className="h-8 text-xs w-36" />
          </div>
          <Button variant="outline" size="sm" className="h-8 mt-4 gap-1.5" disabled={loading} onClick={() => void loadData()}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Students Logged</div>
          <div className="text-xl font-bold">{logs.length}</div>
        </Card>
        <Card className="p-3 border-emerald-500/20 bg-emerald-500/5">
          <div className="text-xs text-emerald-600">Present Today</div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{presentCount}</div>
        </Card>
        <Card className="p-3 border-rose-500/20 bg-rose-500/5">
          <div className="text-xs text-rose-600">Absent / Escalated</div>
          <div className="text-xl font-bold text-rose-700 dark:text-rose-300">{absentCount}</div>
        </Card>
        <Card className="p-3 border-amber-500/20 bg-amber-500/5">
          <div className="text-xs text-amber-600">Unreplied Guardian Alerts</div>
          <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{unrepliedCount}</div>
        </Card>
      </div>

      {/* Open Staff Call Queue Escalations */}
      {tasks.length > 0 && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <PhoneCall className="h-4 w-4" />
              Staff Follow-Up Call Queue ({tasks.length} pending)
            </CardTitle>
            <CardDescription className="text-xs">
              Parent did not reply to WhatsApp alert within 60 minutes. Front-desk phone escalation is required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 text-xs">
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {task.customer?.name ?? "Student"}
                      <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300">URGENT CALL</Badge>
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      Guardian Phone: <span className="font-mono text-foreground font-medium">{task.customer?.phone ?? "N/A"}</span> · Due: {formatDateTime(task.dueAt)}
                    </div>
                    {task.notes && <div className="text-[11px] text-muted-foreground italic mt-1">{task.notes}</div>}
                  </div>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-rose-600 text-white hover:bg-rose-700 text-xs"
                    disabled={resolvingId === task.id}
                    onClick={() => handleResolveTask(task.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {resolvingId === task.id ? "Resolving..." : "Mark Handled"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attendance Roster Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Attendance Log &amp; Guardian Reply Status</CardTitle>
          <CardDescription className="text-xs">
            1-click toggle student attendance status. Marking absent triggers transactional outbox event with auto-parent WhatsApp alert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No attendance logs found for batch &apos;{batch}&apos; on {date}.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Guardian Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Parent WhatsApp Reply</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const isMarking = markingId === log.customerId;
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium text-xs">
                          {log.customer?.name ?? "Student"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {log.guardianPhone || log.customer?.phone || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={log.status === "PRESENT" ? "secondary" : "destructive"}
                            className="text-[10px]"
                          >
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {log.guardianReplyStatus === "ACKNOWLEDGED_LEAVE" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">
                              Replied 1: Leave
                            </Badge>
                          ) : log.guardianReplyStatus === "ACKNOWLEDGED_LATE" ? (
                            <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]">
                              Replied 2: Late
                            </Badge>
                          ) : log.guardianReplyStatus === "NO_REPLY" ? (
                            <Badge variant="destructive" className="text-[10px]">
                              No Reply (Staff Escalation)
                            </Badge>
                          ) : log.status === "ABSENT" ? (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                              Waiting 60m
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant={log.status === "PRESENT" ? "default" : "outline"}
                              className="h-7 text-xs px-2.5"
                              disabled={isMarking}
                              onClick={() => handleMark(log.id, log.customerId, "PRESENT", log.guardianPhone)}
                            >
                              Present
                            </Button>
                            <Button
                              size="sm"
                              variant={log.status === "ABSENT" ? "destructive" : "outline"}
                              className="h-7 text-xs px-2.5"
                              disabled={isMarking}
                              onClick={() => handleMark(log.id, log.customerId, "ABSENT", log.guardianPhone)}
                            >
                              Absent
                            </Button>
                            <Button
                              size="sm"
                              variant={log.status === "LATE" ? "secondary" : "outline"}
                              className="h-7 text-xs px-2.5"
                              disabled={isMarking}
                              onClick={() => handleMark(log.id, log.customerId, "LATE", log.guardianPhone)}
                            >
                              Late
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Membership & Renewal Ledger (Gym Vertical)                                */
/* ------------------------------------------------------------------------- */

function MembershipLedgerTab({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "expiring" | "overdue" | "active">("all");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ memberships: Membership[] }>("/api/memberships");
      setMemberships(res.memberships ?? []);
    } catch (err) {
      toast({ title: "Failed to load memberships", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSendDailySummary = async () => {
    setSummaryBusy(true);
    try {
      const res = await apiPost<{ success: boolean; digest: { activeCount: number; expiringCount: number; pendingDuesAmount: number } }>(
        "/api/memberships",
        { action: "daily_summary" }
      );
      toast({
        title: "Daily Owner Digest Dispatched!",
        description: `Metrics: ${res.digest.activeCount} active, ${res.digest.expiringCount} expiring soon, ${formatINR(res.digest.pendingDuesAmount)} overdue dues.`,
      });
    } catch (err) {
      toast({ title: "Failed to send summary", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSummaryBusy(false);
    }
  };

  const handleTogglePayment = async (membershipId: string, currentStatus: "PAID" | "PENDING" | "OVERDUE") => {
    setTogglingId(membershipId);
    const nextStatus = currentStatus === "PAID" ? "OVERDUE" : "PAID";
    try {
      await apiPatch(`/api/memberships/${encodeURIComponent(membershipId)}/payment`, {
        paymentStatus: nextStatus,
      });
      toast({
        title: "Payment Status Updated",
        description: `Membership marked as ${nextStatus}.`,
      });
      await loadData();
    } catch (err) {
      toast({ title: "Failed to update payment", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const now = Date.now();
  const activeCount = memberships.filter((m) => m.status === "ACTIVE").length;
  const expiringCount = memberships.filter((m) => {
    const exp = new Date(m.expiryDate).getTime();
    return exp > now && exp - now <= 7 * 86400_000;
  }).length;
  const overdueCount = memberships.filter((m) => m.paymentStatus === "OVERDUE").length;

  const filtered = memberships.filter((m) => {
    if (filter === "all") return true;
    if (filter === "expiring") {
      const exp = new Date(m.expiryDate).getTime();
      return exp > now && exp - now <= 7 * 86400_000;
    }
    if (filter === "overdue") return m.paymentStatus === "OVERDUE";
    if (filter === "active") return m.status === "ACTIVE";
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Metric Cards & Summary Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Gym Membership Ledger &amp; Renewal Engine</h2>
          <p className="text-xs text-muted-foreground">
            Automated 7d/3d/1d expiry reminders, renewal payment reconciliation, and daily owner digest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-rose-600 text-white hover:bg-rose-700 text-xs"
            disabled={summaryBusy}
            onClick={handleSendDailySummary}
          >
            <Send className="h-3.5 w-3.5" />
            {summaryBusy ? "Sending Digest..." : "Send Daily Owner Digest"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void loadData()}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Active Members</div>
          <div className="text-xl font-bold">{activeCount}</div>
        </Card>
        <Card className="p-3 border-amber-500/20 bg-amber-500/5">
          <div className="text-xs text-amber-600">Expiring in 7 Days</div>
          <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{expiringCount}</div>
        </Card>
        <Card className="p-3 border-rose-500/20 bg-rose-500/5">
          <div className="text-xs text-rose-600">Overdue Payment Dues</div>
          <div className="text-xl font-bold text-rose-700 dark:text-rose-300">{overdueCount}</div>
        </Card>
        <Card className="p-3 border-emerald-500/20 bg-emerald-500/5">
          <div className="text-xs text-emerald-600 flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Google Sheets Sync
          </div>
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mt-1">Live SSRF-Protected</div>
        </Card>
      </div>

      {/* Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "expiring", "overdue", "active"] as const).map((k) => (
          <Button
            key={k}
            variant={filter === k ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs capitalize"
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "All Members" : k.replace("_", " ")}
          </Button>
        ))}
      </div>

      {/* Roster Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No memberships match the selected filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const expTime = new Date(m.expiryDate).getTime();
                  const diffDays = Math.round((expTime - now) / 86400_000);
                  const isExpiringSoon = diffDays > 0 && diffDays <= 7;
                  const isExpired = diffDays <= 0;
                  const isToggling = togglingId === m.id;

                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium text-xs">
                        {m.customer?.name ?? "Member"}
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {m.customer?.phone || m.customer?.email}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{m.planName}</TableCell>
                      <TableCell className="text-xs">
                        {formatDate(m.expiryDate)}
                        {isExpired ? (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            Expired {Math.abs(diffDays)}d ago
                          </Badge>
                        ) : isExpiringSoon ? (
                          <Badge className="ml-2 text-[10px] bg-amber-500/10 text-amber-600 border-amber-300">
                            {diffDays}d left
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="ml-2 text-[10px] text-emerald-600">
                            {diffDays}d left
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium">
                        {formatINR(m.priceAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={m.paymentStatus === "PAID" ? "secondary" : "destructive"}
                          className="text-[10px]"
                        >
                          {m.paymentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2.5"
                          disabled={isToggling}
                          onClick={() => handleTogglePayment(m.id, m.paymentStatus)}
                        >
                          {isToggling ? "Updating..." : m.paymentStatus === "PAID" ? "Mark Overdue" : "Mark Paid"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
