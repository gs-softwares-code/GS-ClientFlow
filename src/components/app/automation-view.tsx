"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cake,
  CalendarClock,
  Check,
  Hourglass,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  UserX,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost } from "@/lib/client/api";
import { formatDateTime, timeAgo } from "@/lib/client/format";
import type { AppCtx } from "@/lib/client/types";

/* ---------- DTOs (mirrors of the API responses) ---------- */

type ChannelId = "email" | "sms" | "whatsapp";
type TriggerType = "event" | "date" | "manual";
type DateKind = "birthday" | "inactive" | "offer_expiry" | "appointment_reminder";
type ConditionRule = { attr: string; op: string; value: string | number | (string | number)[] };

type Workflow = {
  id: string;
  name: string;
  category: string;
  triggerType: TriggerType;
  triggerEvent: string | null;
  dateKind: DateKind | null;
  offsetMinutes: number | null;
  conditionRules: ConditionRule[];
  segmentId: string | null;
  channel: ChannelId;
  template: string;
  requireConsent: boolean;
  active: boolean;
  lastRunAt: string | null;
};

type SegmentRef = { id: string; name: string };
type WorkflowsResponse = { workflows: Workflow[]; segments: SegmentRef[] };

type WorkflowRunStep = { step: string; detail: string; ok: boolean };
type WorkflowRun = {
  id: string;
  workflow: { id: string; name: string; category: string };
  customer: { id: string; name: string } | null;
  status: "completed" | "skipped" | "failed" | "scheduled";
  triggerInfo: Record<string, unknown>;
  steps: WorkflowRunStep[];
  createdAt: string;
};
type RunsResponse = { runs: WorkflowRun[] };
type RunSummary = { executed: number; skipped: number; failed: number; scheduled: number };

type OutboxEvent = {
  id: string;
  type: string;
  status: "pending" | "processing" | "done" | "dead";
  attempts: number;
  maxAttempts: number;
  availableAt: string | null;
  processedAt: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
type EventsResponse = { events: OutboxEvent[]; counts: { status: string; count: number }[] };

type ScheduledAction = { id: string; kind: string; dueAt: string; payload: Record<string, string> };
type SchedulerSnapshot = {
  counts: { status: string; count: number }[];
  dueNow: number;
  nextDue: string | null;
  upcoming: ScheduledAction[];
};
type OpsOverview = { scheduled: SchedulerSnapshot };
type OpsActionResult = { message: string };

type WorkflowDraft = {
  name: string;
  category: string;
  triggerType: TriggerType;
  triggerEvent: string;
  dateKind: DateKind;
  delayMinutes: string;
  channel: ChannelId;
  template: string;
  requireConsent: boolean;
  segmentId: string;
  conditions: { attr: string; op: string; value: string }[];
};

/* ---------- constants & pure helpers ---------- */

const WORKFLOW_CATEGORIES = [
  "birthday", "onboarding", "inactive", "appointment_reminder", "feedback_followup", "offer_expiry", "custom",
] as const;
const DATE_KINDS: DateKind[] = ["birthday", "inactive", "offer_expiry", "appointment_reminder"];
const CONDITION_ATTRS = [
  "visitCount", "totalSpendCents", "lastVisitDaysAgo", "birthdayMonth", "pointsBalance", "feedbackAvg", "feedbackRating",
] as const;
const CONDITION_OPS = ["eq", "neq", "gte", "lte", "between"] as const;
const QUEUE_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "dead", label: "Dead" },
] as const;

function emptyDraft(channel: ChannelId): WorkflowDraft {
  return {
    name: "",
    category: "onboarding",
    triggerType: "event",
    triggerEvent: "",
    dateKind: "birthday",
    delayMinutes: "0",
    channel,
    template: "",
    requireConsent: true,
    segmentId: "none",
    conditions: [],
  };
}

/** Human-readable delay: <60 -> "X min", otherwise "Xh Ym". */
function humanDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function describeTrigger(w: Workflow, birthdayLeadDays: number, inactiveDays: number): string {
  if (w.triggerType === "event") return `Event: ${w.triggerEvent ?? "—"}`;
  if (w.triggerType === "date") {
    switch (w.dateKind) {
      case "birthday":
        return `Date: birthday (${birthdayLeadDays}d lead)`;
      case "inactive":
        return `Date: inactive (${inactiveDays}d+ no visit)`;
      case "offer_expiry":
        return "Date: offer expiry (3d before)";
      case "appointment_reminder":
        return "Date: appointment reminder";
      default:
        return "Date trigger";
    }
  }
  return "Manual";
}

function eventStatusClass(status: OutboxEvent["status"]): string {
  switch (status) {
    case "pending":
      return "bg-amber-600 border-transparent text-white";
    case "processing":
      return "border-amber-600 bg-transparent text-amber-700";
    case "done":
      return "bg-emerald-600 border-transparent text-white";
    case "dead":
      return "bg-rose-600 border-transparent text-white";
  }
}

function runStatusClass(status: WorkflowRun["status"]): string {
  switch (status) {
    case "completed":
      return "bg-emerald-600 border-transparent text-white";
    case "scheduled":
      return "bg-amber-600 border-transparent text-white";
    case "failed":
      return "bg-rose-600 border-transparent text-white";
    case "skipped":
      return "bg-muted border-transparent text-muted-foreground";
  }
}

function scheduledStatusClass(status: string): string {
  switch (status) {
    case "pending":
      return "border-amber-600 text-amber-700";
    case "done":
      return "border-emerald-600 text-emerald-700";
    case "failed":
      return "border-rose-600 text-rose-700";
    default:
      return "text-muted-foreground";
  }
}

function ruleValue(value: string | number | (string | number)[]): string {
  if (Array.isArray(value)) return value.join("-");
  return String(value);
}

/* ---------- view ---------- */

export default function AutomationView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("workflows");

  const channels = ctx.tenant.settings.channels;
  const enabledChannels = useMemo<ChannelId[]>(
    () => (Object.keys(channels) as ChannelId[]).filter((c) => channels[c].enabled),
    [channels]
  );

  /* Workflows tab */
  const [wfData, setWfData] = useState<WorkflowsResponse | null>(null);
  const [wfLoading, setWfLoading] = useState(true);
  const [runBusyId, setRunBusyId] = useState<string | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setWfLoading(true);
    try {
      const res = await apiGet<WorkflowsResponse>("/api/workflows");
      setWfData(res);
    } catch (err) {
      toast({ title: "Could not load workflows", description: (err as Error).message, variant: "destructive" });
    } finally {
      setWfLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const toggleActive = async (wf: Workflow, next: boolean) => {
    setToggleBusyId(wf.id);
    try {
      await apiPatch("/api/workflows", { workflowId: wf.id, active: next });
      setWfData((prev) =>
        prev ? { ...prev, workflows: prev.workflows.map((x) => (x.id === wf.id ? { ...x, active: next } : x)) } : prev
      );
      toast({
        title: next ? "Workflow activated" : "Workflow paused",
        description: `${wf.name} ${next ? "will fire on its trigger" : "no longer fires"}.`,
      });
    } catch (err) {
      toast({ title: "Could not update the workflow", description: (err as Error).message, variant: "destructive" });
    } finally {
      setToggleBusyId(null);
    }
  };

  const runNow = async (wf: Workflow) => {
    setRunBusyId(wf.id);
    try {
      const res = await apiPatch<{ run: RunSummary }>("/api/workflows", { workflowId: wf.id, run: true });
      const r = res.run;
      toast({
        title: "Run finished",
        description: `${r.executed} sent, ${r.skipped} skipped, ${r.scheduled} scheduled${r.failed > 0 ? `, ${r.failed} failed` : ""}`,
      });
      void loadWorkflows();
    } catch (err) {
      toast({ title: "Run failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRunBusyId(null);
    }
  };

  /* Execution logs dialog */
  const [logsFor, setLogsFor] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const openLogs = useCallback(
    async (wf: Workflow) => {
      setLogsFor(wf);
      setRuns([]);
      setRunsLoading(true);
      try {
        const res = await apiGet<RunsResponse>(`/api/workflows/runs?workflowId=${encodeURIComponent(wf.id)}`);
        setRuns(res.runs);
      } catch (err) {
        toast({ title: "Could not load execution logs", description: (err as Error).message, variant: "destructive" });
        setLogsFor(null);
      } finally {
        setRunsLoading(false);
      }
    },
    [toast]
  );

  /* New workflow dialog */
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft>(() => emptyDraft(enabledChannels[0] ?? "email"));

  const openCreate = () => {
    setDraft(emptyDraft(enabledChannels[0] ?? "email"));
    setCreateOpen(true);
  };
  const upDraft = (patch: Partial<WorkflowDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const addCondition = () =>
    setDraft((d) => ({ ...d, conditions: [...d.conditions, { attr: CONDITION_ATTRS[0], op: "gte", value: "" }] }));
  const removeCondition = (i: number) => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, idx) => idx !== i) }));
  const setCondition = (i: number, patch: Partial<{ attr: string; op: string; value: string }>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));

  const createWorkflow = async () => {
    if (!draft.name.trim() || !draft.template.trim()) {
      toast({ title: "Missing details", description: "A name and a message template are required.", variant: "destructive" });
      return;
    }
    if (draft.triggerType === "event" && !draft.triggerEvent) {
      toast({ title: "Missing trigger event", description: "Pick the event that starts this workflow.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await apiPost("/api/workflows", {
        name: draft.name.trim(),
        category: draft.category,
        triggerType: draft.triggerType,
        triggerEvent: draft.triggerType === "event" ? draft.triggerEvent : null,
        dateKind: draft.triggerType === "date" ? draft.dateKind : null,
        offsetMinutes: Math.max(0, Number.parseInt(draft.delayMinutes, 10) || 0),
        conditionRules: draft.conditions
          .filter((c) => c.value.trim() !== "")
          .map((c) => ({ attr: c.attr, op: c.op, value: c.value })),
        segmentId: draft.segmentId === "none" ? null : draft.segmentId,
        channel: draft.channel,
        template: draft.template.trim(),
        requireConsent: draft.requireConsent,
      });
      toast({ title: "Workflow created (active)", description: `${draft.name.trim()} is live — it will fire on its trigger.` });
      setCreateOpen(false);
      void loadWorkflows();
    } catch (err) {
      toast({ title: "Could not create workflow", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  /* Event queue tab */
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [queue, setQueue] = useState<EventsResponse | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);

  const loadQueue = useCallback(
    async (status: string) => {
      setQueueLoading(true);
      try {
        const suffix = status === "all" ? "" : `&status=${status}`;
        const res = await apiGet<EventsResponse>(`/api/events?limit=50${suffix}`);
        setQueue(res);
      } catch (err) {
        toast({ title: "Could not load the event queue", description: (err as Error).message, variant: "destructive" });
      } finally {
        setQueueLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (tab === "queue") void loadQueue(queueFilter);
  }, [tab, queueFilter, loadQueue]);

  const retryDead = async (e: OutboxEvent) => {
    setRetryBusyId(e.id);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>("/api/events", { eventId: e.id, action: "retry" });
      toast({ title: "Event requeued", description: res.message });
      void loadQueue(queueFilter);
    } catch (err) {
      toast({ title: "Could not requeue the event", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRetryBusyId(null);
    }
  };

  /* Date triggers & scheduler tab */
  const [scheduler, setScheduler] = useState<SchedulerSnapshot | null>(null);
  const [schedLoading, setSchedLoading] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);

  const loadScheduler = useCallback(async () => {
    setSchedLoading(true);
    try {
      const res = await apiGet<OpsOverview>("/api/ops");
      setScheduler(res.scheduled);
    } catch (err) {
      toast({ title: "Could not load the scheduler snapshot", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSchedLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === "triggers") void loadScheduler();
  }, [tab, loadScheduler]);

  const runOps = async (action: "tick" | "scan") => {
    setOpsBusy(true);
    try {
      const res = await apiPost<OpsActionResult>("/api/ops", { action });
      toast({
        title: action === "tick" ? "Worker tick executed" : "Scheduler scan executed",
        description: res.message,
      });
      if (tab === "triggers") void loadScheduler();
      if (tab === "queue") void loadQueue(queueFilter);
    } catch (err) {
      toast({ title: "Ops action failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setOpsBusy(false);
    }
  };

  /* Render helpers */
  const segmentNameOf = (id: string | null): string => {
    if (!id) return "";
    const seg = wfData?.segments.find((s) => s.id === id);
    return seg ? seg.name : "segment";
  };

  const audienceLine = (w: Workflow): string => {
    if (w.segmentId) return `Audience: ${segmentNameOf(w.segmentId)} segment`;
    if (w.conditionRules.length > 0) {
      const summary = w.conditionRules.map((r) => `${r.attr} ${r.op} ${ruleValue(r.value)}`).join(", ");
      return `Conditions: ${summary}`;
    }
    return "Audience: all active customers";
  };

  const counts = queue?.counts ?? [];
  const countOf = (status: string) => counts.find((c) => c.status === status)?.count ?? 0;
  const totalCount = counts.reduce((sum, c) => sum + c.count, 0);

  const dateKindHint = (k: DateKind): string => {
    switch (k) {
      case "birthday":
        return `Fires ${ctx.tenant.settings.birthdayLeadDays} days ahead of the birthday — yearly dedupe.`;
      case "inactive":
        return `Fires after ${ctx.tenant.settings.inactiveDays}+ days without a visit — monthly dedupe.`;
      case "offer_expiry":
        return "Fires 3 days before the offer expires.";
      case "appointment_reminder":
        return "Fires ahead of each booked appointment.";
    }
  };

  const workflows = wfData?.workflows ?? [];
  const activeCount = workflows.filter((w) => w.active).length;

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Automation</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Configurable workflow engine on the transactional outbox</p>
        </div>
        <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
          <WorkflowIcon className="h-3 w-3 text-[var(--brand)]" />
          {activeCount} active of {workflows.length} workflows
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="workflows" className="whitespace-nowrap">Workflows</TabsTrigger>
          <TabsTrigger value="queue" className="whitespace-nowrap">Event queue</TabsTrigger>
          <TabsTrigger value="triggers" className="whitespace-nowrap">Date triggers &amp; scheduler</TabsTrigger>
        </TabsList>

        {/* ---------- TAB 1: workflows ---------- */}
        <TabsContent value="workflows" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={wfLoading} onClick={() => void loadWorkflows()}>
              <RefreshCw className={`h-3.5 w-3.5 ${wfLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              size="sm"
              className="ml-auto gap-1.5 bg-[var(--brand)] text-white hover:opacity-90"
              onClick={openCreate}
            >
              <Plus className="h-3.5 w-3.5" /> New workflow
            </Button>
          </div>

          {wfLoading && !wfData ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="space-y-3 p-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-7 w-32" />
                </Card>
              ))}
            </div>
          ) : workflows.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {workflows.map((w) => (
                <Card key={w.id} className="flex flex-col">
                  <CardHeader className="gap-1.5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-sm leading-snug">{w.name}</CardTitle>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {w.active ? "on" : "off"}
                        </span>
                        <Switch
                          checked={w.active}
                          disabled={toggleBusyId === w.id}
                          onCheckedChange={(v) => void toggleActive(w, v)}
                          aria-label={w.active ? `Deactivate ${w.name}` : `Activate ${w.name}`}
                        />
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      {describeTrigger(w, ctx.tenant.settings.birthdayLeadDays, ctx.tenant.settings.inactiveDays)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{w.category.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline" className="text-[10px] uppercase">{w.channel}</Badge>
                      {!w.requireConsent ? (
                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">no consent check</Badge>
                      ) : null}
                    </div>
                    {w.offsetMinutes && w.offsetMinutes > 0 ? (
                      <p className="text-muted-foreground">waits {humanDelay(w.offsetMinutes)} before sending</p>
                    ) : null}
                    <p className="leading-snug text-muted-foreground">{audienceLine(w)}</p>
                    <div className="line-clamp-2 rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-snug text-muted-foreground">
                      {w.template}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Last run {timeAgo(w.lastRunAt)}</p>
                  </CardContent>
                  <CardFooter className="gap-2 pb-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={runBusyId === w.id}
                      onClick={() => void runNow(w)}
                    >
                      {runBusyId === w.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Run now
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void openLogs(w)}>
                      <ScrollText className="h-3.5 w-3.5" /> Logs
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <WorkflowIcon className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No workflows yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Automate birthdays, win-backs, reminders and follow-ups — event, date or manual triggers.
              </p>
              <Button size="sm" className="mt-4 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> New workflow
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ---------- TAB 2: event queue (outbox browser) ---------- */}
        <TabsContent value="queue" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {QUEUE_FILTERS.map((f) => {
              const active = queueFilter === f.id;
              const n = f.id === "all" ? totalCount : countOf(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQueueFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {f.label}
                  <span className="ml-1 tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              disabled={opsBusy}
              onClick={() => void runOps("tick")}
            >
              <Zap className="h-3.5 w-3.5" /> Run worker tick now
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              {queueLoading && !queue ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="space-y-2.5 p-4">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-10 w-full" />
                  </Card>
                ))
              ) : queue && queue.events.length > 0 ? (
                <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {queue.events.map((e) => (
                    <Card key={e.id} className="p-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="font-mono text-xs font-semibold">{e.type}</span>
                        <Badge variant="outline" className={`capitalize text-[10px] ${eventStatusClass(e.status)}`}>
                          {e.status}
                        </Badge>
                        <span className="tabular-nums text-[10px] text-muted-foreground">
                          {e.attempts}/{e.maxAttempts} attempts
                        </span>
                        {e.dedupeKey ? (
                          <span
                            className="max-w-[150px] truncate font-mono text-[10px] text-muted-foreground/80"
                            title={e.dedupeKey}
                          >
                            {e.dedupeKey}
                          </span>
                        ) : null}
                        <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {e.status === "pending" && e.availableAt ? (
                          <span>available {formatDateTime(e.availableAt)}</span>
                        ) : null}
                        {e.status === "done" && e.processedAt ? <span>processed {formatDateTime(e.processedAt)}</span> : null}
                      </div>
                      {e.lastError ? <p className="mt-1.5 line-clamp-2 text-xs text-rose-600">{e.lastError}</p> : null}
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <details className="min-w-0 flex-1">
                          <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
                            payload
                          </summary>
                          <pre className="mt-1.5 overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </details>
                        {e.status === "dead" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1 text-xs"
                            disabled={retryBusyId === e.id}
                            onClick={() => void retryDead(e)}
                          >
                            <RotateCcw className="h-3 w-3" /> Retry from DLQ
                          </Button>
                        ) : null}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <Zap className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-medium">The outbox is idle</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No events match this filter — worker ticks drain the queue automatically.
                  </p>
                </Card>
              )}
            </div>

            <Card className="h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4 text-[var(--brand)]" /> Event contract catalog
                </CardTitle>
                <CardDescription>Event types this business emits — workflows subscribe to these</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                  {ctx.eventCatalog.length > 0 ? (
                    ctx.eventCatalog.map((c) => (
                      <div key={c.type} className="rounded-lg border px-3 py-2">
                        <div className="font-mono text-xs font-medium">{c.type}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{c.description}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground/70">source: {c.source}</div>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-xs text-muted-foreground">No catalog available.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------- TAB 3: date triggers & scheduler ---------- */}
        <TabsContent value="triggers" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">How date triggers work</CardTitle>
              <CardDescription>One scheduler scan covers every tenant — no per-tenant cron jobs to configure.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  icon: Cake,
                  title: "Birthday",
                  text: `Fires ${ctx.tenant.settings.birthdayLeadDays} days ahead of the customer's birthday — yearly dedupe keeps it to one wish per year.`,
                },
                {
                  icon: UserX,
                  title: "Inactive re-engagement",
                  text: `${ctx.tenant.settings.inactiveDays}+ days without a visit triggers a win-back flow — monthly dedupe prevents nagging.`,
                },
                {
                  icon: Hourglass,
                  title: "Offer expiry",
                  text: "3 days before the offer's expiresAt — nudges customers to use it before it lapses.",
                },
              ].map((row) => (
                <div key={row.title} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                  <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{row.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.text}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4 text-[var(--brand)]" /> Scheduled actions
              </CardTitle>
              <CardDescription>
                Delayed workflow steps, reminders and expiry nudges queued for the worker
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {schedLoading && !scheduler ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : scheduler ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {scheduler.counts.length > 0 ? (
                      scheduler.counts.map((c) => (
                        <Badge
                          key={c.status}
                          variant="outline"
                          className={`capitalize text-[10px] ${scheduledStatusClass(c.status)}`}
                        >
                          {c.count} {c.status}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No scheduled actions yet.</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Due now</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums">{scheduler.dueNow}</p>
                    </div>
                    <div className="rounded-lg border px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Next due</p>
                      <p className="mt-0.5 text-sm font-medium">{formatDateTime(scheduler.nextDue)}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</p>
                    <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                      {scheduler.upcoming.length > 0 ? (
                        scheduler.upcoming.map((a) => (
                          <div
                            key={a.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs"
                          >
                            <span className="font-medium">{a.kind.replace(/_/g, " ")}</span>
                            <span className="text-[11px] text-muted-foreground">{formatDateTime(a.dueAt)}</span>
                            <span className="font-mono text-[10px] text-muted-foreground/70">
                              {Object.keys(a.payload).length > 0 ? Object.keys(a.payload).join(", ") : "no payload"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="py-6 text-center text-xs text-muted-foreground">Nothing scheduled right now.</p>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={opsBusy}
              onClick={() => void runOps("scan")}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${opsBusy ? "animate-spin" : ""}`} /> Run scheduler scan now
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={opsBusy} onClick={() => void runOps("tick")}>
              <Zap className="h-3.5 w-3.5" /> Run worker tick
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* ---------- execution logs dialog ---------- */}
      <Dialog open={logsFor !== null} onOpenChange={(open) => !open && setLogsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Execution logs — {logsFor?.name}</DialogTitle>
            <DialogDescription>Most recent runs with per-step outcomes, processed by the outbox worker.</DialogDescription>
          </DialogHeader>
          {runsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : runs.length > 0 ? (
            <Accordion type="multiple" className="max-h-[440px] overflow-y-auto pr-1">
              {runs.map((r) => (
                <AccordionItem key={r.id} value={r.id} className="rounded-lg border px-3">
                  <AccordionTrigger className="py-2.5 text-xs hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-2 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge className={`shrink-0 capitalize text-[10px] ${runStatusClass(r.status)}`}>{r.status}</Badge>
                        <span className="truncate text-xs font-medium">{r.customer?.name ?? "no matching customer"}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2.5 pb-3">
                    {Object.keys(r.triggerInfo).length > 0 ? (
                      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {Object.entries(r.triggerInfo)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join("  ")}
                      </p>
                    ) : null}
                    <ol className="space-y-1.5">
                      {r.steps.map((s, i) => (
                        <li key={`${r.id}-${i}`} className="flex items-start gap-2 text-[11px] leading-snug">
                          {s.ok ? (
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          ) : (
                            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                          )}
                          <span className="min-w-0">
                            <span className="font-medium">{s.step}</span>
                            {s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No runs recorded yet — press &quot;Run now&quot; or wait for the next trigger.
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- new workflow dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">New workflow</DialogTitle>
            <DialogDescription>
              Event, date or manual trigger — every send goes through the transactional outbox with retries.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={draft.name}
                onChange={(e) => upDraft({ name: e.target.value })}
                placeholder="Low rating follow-up"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-category">Category</Label>
                <Select value={draft.category} onValueChange={(v) => upDraft({ category: v })}>
                  <SelectTrigger id="wf-category" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKFLOW_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-trigger">Trigger type</Label>
                <Select value={draft.triggerType} onValueChange={(v) => upDraft({ triggerType: v as TriggerType })}>
                  <SelectTrigger id="wf-trigger" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["event", "date", "manual"] as const).map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {draft.triggerType === "event" ? (
              <div className="space-y-1.5">
                <Label htmlFor="wf-event">Trigger event</Label>
                <Select value={draft.triggerEvent} onValueChange={(v) => upDraft({ triggerEvent: v })}>
                  <SelectTrigger id="wf-event" className="text-xs">
                    <SelectValue placeholder="Pick an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {ctx.eventCatalog.map((c) => (
                      <SelectItem key={c.type} value={c.type} className="font-mono text-xs">
                        {c.type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">The workflow starts whenever this event is published.</p>
              </div>
            ) : null}

            {draft.triggerType === "date" ? (
              <div className="space-y-1.5">
                <Label htmlFor="wf-datekind">Date trigger</Label>
                <Select value={draft.dateKind} onValueChange={(v) => upDraft({ dateKind: v as DateKind })}>
                  <SelectTrigger id="wf-datekind" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_KINDS.map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {k.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">{dateKindHint(draft.dateKind)}</p>
              </div>
            ) : null}

            {draft.triggerType === "manual" ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                Manual workflows run on demand from the Run now button — optionally scoped to a segment audience below.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-delay">Delay (minutes)</Label>
                <Input
                  id="wf-delay"
                  type="number"
                  min={0}
                  value={draft.delayMinutes}
                  onChange={(e) => upDraft({ delayMinutes: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">0 = send immediately.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-channel">Channel</Label>
                <Select value={draft.channel} onValueChange={(v) => upDraft({ channel: v as ChannelId })}>
                  <SelectTrigger id="wf-channel" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledChannels.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {ctx.tenant.settings.channels[c].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Only channels enabled for this business.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wf-template">Message template</Label>
              <Textarea
                id="wf-template"
                rows={4}
                value={draft.template}
                onChange={(e) => upDraft({ template: e.target.value })}
                placeholder="Hi {name}, we would love to see you again at {business}!"
              />
              <p className="text-[10px] text-muted-foreground">{"Variables: {name} {full_name} {business} {points}"}</p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="wf-consent" className="text-xs">
                  Require marketing consent
                </Label>
                <p className="text-[10px] text-muted-foreground">Skips customers who never opted in</p>
              </div>
              <Switch
                id="wf-consent"
                checked={draft.requireConsent}
                onCheckedChange={(v) => upDraft({ requireConsent: v })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wf-segment">Audience segment (optional)</Label>
              <Select value={draft.segmentId} onValueChange={(v) => upDraft({ segmentId: v })}>
                <SelectTrigger id="wf-segment" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    Everyone (with rules below)
                  </SelectItem>
                  {wfData?.segments.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Attribute conditions</Label>
                <span className="text-[10px] text-muted-foreground">all rules must match</span>
              </div>
              {draft.conditions.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select value={c.attr} onValueChange={(v) => setCondition(i, { attr: v })}>
                    <SelectTrigger className="h-8 w-[150px] flex-1 text-xs" aria-label="Attribute">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_ATTRS.map((a) => (
                        <SelectItem key={a} value={a} className="font-mono text-xs">
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={c.op} onValueChange={(v) => setCondition(i, { op: v })}>
                    <SelectTrigger className="h-8 w-[92px] text-xs" aria-label="Operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPS.map((o) => (
                        <SelectItem key={o} value={o} className="font-mono text-xs">
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={c.value}
                    onChange={(e) => setCondition(i, { value: e.target.value })}
                    placeholder="value"
                    className="h-8 min-w-[90px] flex-1 text-xs"
                    aria-label="Value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    onClick={() => removeCondition(i)}
                    aria-label="Remove condition"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={addCondition}>
                <Plus className="h-3.5 w-3.5" /> Add condition
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={creating}
              onClick={() => void createWorkflow()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {creating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Create workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
