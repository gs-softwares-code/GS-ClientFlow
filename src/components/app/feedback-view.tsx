"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search, Star } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost, downloadFile } from "@/lib/client/api";
import { initials, timeAgo } from "@/lib/client/format";
import type { AppCtx, CustomerListItem } from "@/lib/client/types";

// Local DTOs (mirrors of the API responses)
type FeedbackItem = {
  id: string; rating: number; comment: string | null; status: string; followUpStatus: string;
  createdAt: string; updatedAt: string; customer: { id: string; name: string; email: string };
};
type FeedbackListResponse = { items: FeedbackItem[]; nextCursor: string | null; hasMore: boolean };
type CustomerListResponse = { items: CustomerListItem[]; nextCursor: string | null; hasMore: boolean };
type TrendReport = {
  count: number; avg: number | null; pendingReview: number;
  distribution: { rating: number; count: number }[];
  trend: { month: string; avg: number; count: number }[];
};

const PAGE_SIZE = 25;
type FeedbackFilter = "all" | "low" | "review" | "followup";

const chartConfig: ChartConfig = { count: { label: "Responses", color: "#d97706" } };

function feedbackStatusBadge(f: FeedbackItem): { variant: "secondary" | "outline"; className: string } {
  if (f.status === "reviewed") return { variant: "secondary", className: "text-[10px]" };
  if (f.status === "new") return { variant: "outline", className: "border-amber-600 bg-amber-600/10 text-[10px] text-amber-700" };
  if (f.status === "actioned") return { variant: "outline", className: "border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700" };
  return { variant: "outline", className: "text-[10px]" };
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Badge
      role="button" tabIndex={0} aria-pressed={active} variant={active ? "default" : "outline"}
      className={`cursor-pointer select-none px-3 py-1.5 text-xs ${
        active ? "border-transparent bg-[var(--brand)] text-white" : "text-muted-foreground hover:bg-accent"
      }`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main view: filter chips + 90-day trend card + cursor-paginated list
// ---------------------------------------------------------------------------

export default function FeedbackView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();

  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const [trend, setTrend] = useState<TrendReport | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const loadTrend = useCallback(async () => {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 90 * 86400_000);
      const res = await apiGet<TrendReport>(`/api/analytics?report=feedback&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`);
      setTrend(res);
    } catch (err) {
      toast({ title: "Could not load feedback trend", description: (err as Error).message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => { void loadTrend(); }, [loadTrend]);

  const fetchPage = useCallback(async (cursor: string | null, mode: "replace" | "append") => {
    const seq = ++requestSeq.current;
    if (mode === "replace") setLoading(true);
    if (mode === "append") setLoadingMore(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) p.set("cursor", cursor);
      if (filter === "low") p.set("maxRating", "3");
      if (filter === "review") p.set("status", "new");
      const res = await apiGet<FeedbackListResponse>(`/api/feedback?${p.toString()}`);
      if (seq !== requestSeq.current) return;
      setItems((prev) => (mode === "append" ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setListError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setListError((err as Error).message);
      toast({ title: "Could not load feedback", description: (err as Error).message, variant: "destructive" });
    } finally {
      if (seq === requestSeq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [filter, toast]);

  useEffect(() => { void fetchPage(null, "replace"); }, [fetchPage]);

  const loadMore = () => { if (nextCursor && !loadingMore) void fetchPage(nextCursor, "append"); };

  const markReviewed = async (f: FeedbackItem) => {
    try {
      await apiPatch(`/api/feedback/${f.id}`, { status: "reviewed" });
      toast({ title: "Marked as reviewed", description: `${f.customer.name} — ${f.rating}/5` });
      setItems((prev) =>
        filter === "review" ? prev.filter((it) => it.id !== f.id) : prev.map((it) => (it.id === f.id ? { ...it, status: "reviewed" } : it))
      );
      void loadTrend();
    } catch (err) {
      toast({ title: "Could not update feedback", description: (err as Error).message, variant: "destructive" });
    }
  };

  const followUpDone = async (f: FeedbackItem) => {
    try {
      await apiPatch(`/api/feedback/${f.id}`, { followUpDone: true });
      toast({ title: "Follow-up done", description: `${f.customer.name} — the loop is closed` });
      setItems((prev) =>
        filter === "followup"
          ? prev.filter((it) => it.id !== f.id)
          : prev.map((it) => (it.id === f.id ? { ...it, followUpStatus: "done" } : it))
      );
    } catch (err) {
      toast({ title: "Could not update feedback", description: (err as Error).message, variant: "destructive" });
    }
  };

  // "Follow-up pending" is a client-side filter on top of the loaded page
  const visibleItems = filter === "followup" ? items.filter((f) => f.followUpStatus === "pending") : items;
  const distData = useMemo(() => (trend?.distribution ?? []).map((d) => ({ star: `${d.rating}★`, count: d.count })), [trend]);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => downloadFile("/api/export/feedback", `feedback-${ctx.tenant.slug}.csv`)}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button className="h-10 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={() => setLogOpen(true)}>
            <Plus className="h-4 w-4" /> Log feedback
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
        <Chip label="Low ratings (≤3)" active={filter === "low"} onClick={() => setFilter("low")} />
        <Chip label="Needs review" active={filter === "review"} onClick={() => setFilter("review")} />
        <Chip label="Follow-up pending" active={filter === "followup"} onClick={() => setFilter("followup")} />
      </div>

      {/* Trend card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Star className="h-4 w-4 text-[var(--brand)]" /> Feedback pulse — last 90 days
          </CardTitle>
          <CardDescription>Rating distribution and review backlog, computed live</CardDescription>
        </CardHeader>
        <CardContent className="grid items-center gap-4 sm:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{trend ? (trend.avg ?? "—") : "…"}</span>
              <span className="text-sm text-muted-foreground">/ 5 average</span>
            </div>
            <p className="text-sm text-muted-foreground">{trend ? `${trend.count} responses` : "Loading responses"}</p>
            {trend ? (
              trend.pendingReview > 0 ? (
                <Badge variant="outline" className="border-amber-600 bg-amber-600/10 text-amber-700">{trend.pendingReview} awaiting review</Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-emerald-700">Review queue clear</Badge>
              )
            ) : null}
          </div>
          {trend ? (
            <ChartContainer config={chartConfig} className="h-40 w-full">
              <BarChart data={distData} margin={{ right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="star" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </CardContent>
      </Card>

      {/* List (cursor-paginated) */}
      {listError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load feedback</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{listError}</span>
            <Button size="sm" variant="outline" onClick={() => void fetchPage(null, "replace")}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {loading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
        ) : visibleItems.length ? (
          visibleItems.map((f) => (
            <FeedbackRow key={f.id} feedback={f} onReviewed={() => void markReviewed(f)} onFollowUpDone={() => void followUpDone(f)} />
          ))
        ) : (
          <div className="rounded-xl border py-12 text-center text-sm text-muted-foreground">No feedback matches this filter.</div>
        )}
      </div>

      {hasMore && !loading && (
        <Button variant="outline" className="h-10 w-full" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : `Load ${PAGE_SIZE} more`}
        </Button>
      )}

      <LogFeedbackDialog open={logOpen} onOpenChange={setLogOpen} onLogged={() => { void fetchPage(null, "replace"); void loadTrend(); }} />
    </div>
  );
}

function FeedbackRow({ feedback: f, onReviewed, onFollowUpDone }: { feedback: FeedbackItem; onReviewed: () => void; onFollowUpDone: () => void }) {
  const status = feedbackStatusBadge(f);
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-start gap-1 sm:w-28">
          <div className="flex gap-0.5" aria-label={`${f.rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`h-4 w-4 ${n <= f.rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground/60"}`} />
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{timeAgo(f.createdAt)}</span>
        </div>
        <div className="min-w-0 flex-1">
          {f.comment ? <p className="line-clamp-2 text-sm">{f.comment}</p> : <p className="text-sm text-muted-foreground">No comment left.</p>}
          <p className="mt-1 truncate text-xs text-muted-foreground">{f.customer.name} · {f.customer.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={status.variant} className={status.className}>{f.status}</Badge>
            {f.followUpStatus === "pending" && (
              <Badge variant="outline" className="border-amber-600 bg-amber-600/10 text-[10px] text-amber-700">Follow-up pending</Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
          {f.status !== "reviewed" && f.status !== "actioned" && (
            <Button variant="outline" size="sm" className="h-9" onClick={onReviewed}>Reviewed</Button>
          )}
          {f.followUpStatus === "pending" && (
            <Button variant="outline" size="sm" className="h-9" onClick={onFollowUpDone}>Follow-up done</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Log feedback dialog (staff entry): customer picker + star rating + comment
function LogFeedbackDialog({ open, onOpenChange, onLogged }: { open: boolean; onOpenChange: (o: boolean) => void; onLogged: () => void }) {
  const { toast } = useToast();
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<CustomerListItem[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickerQuery(""); setPickerResults(null); setCustomerId(null); setCustomerName(""); setRating(0); setComment("");
  }, [open]);

  // debounce the customer picker search (400ms)
  useEffect(() => {
    if (!open) return;
    const q = pickerQuery.trim();
    setPickerLoading(true);
    const t = setTimeout(() => {
      apiGet<CustomerListResponse>(`/api/customers?limit=20&search=${encodeURIComponent(q)}`)
        .then((res) => setPickerResults(res.items))
        .catch(() => setPickerResults([]))
        .finally(() => setPickerLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [open, pickerQuery]);

  const submit = async () => {
    if (!customerId) {
      toast({ title: "Pick a customer first", variant: "destructive" });
      return;
    }
    if (rating < 1) {
      toast({ title: "Pick a star rating", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiPost("/api/feedback", { customerId, rating, comment: comment.trim() || null });
      toast({
        title: "Feedback logged — event queued",
        description: "Loyalty points credit follows automatically on the next worker tick.",
      });
      onOpenChange(false);
      onLogged();
    } catch (err) {
      toast({ title: "Could not log feedback", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log feedback</DialogTitle>
          <DialogDescription>Staff-entered feedback — a feedback.submitted event is queued in the outbox.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {customerId ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">{initials(customerName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{customerName}</p>
                  <p className="text-xs text-muted-foreground">Selected customer</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => { setCustomerId(null); setCustomerName(""); }}>Change</Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="fb-customer">Customer</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="fb-customer" className="h-10 pl-9" placeholder="Search by name or email" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                {pickerLoading && !pickerResults ? (
                  <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : pickerResults?.length ? (
                  pickerResults.map((c) => (
                    <button key={c.id} type="button" className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
                      onClick={() => { setCustomerId(c.id); setCustomerName(c.name); }}>
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-[var(--brand)]/10 text-[11px] font-semibold text-[var(--brand)]">{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">No customers found.</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Star rating</Label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={rating === n}
                  className={`grid h-11 w-11 place-items-center rounded-lg border transition-colors ${n <= rating ? "border-amber-500 bg-amber-500/10" : "hover:bg-accent"}`}
                  onClick={() => setRating(n)}>
                  <Star className={`h-5 w-5 ${n <= rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-comment">Comment (optional)</Label>
            <Textarea id="fb-comment" rows={3} placeholder="What did the customer say?" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving} onClick={() => void submit()}>
            {saving ? "Logging…" : "Log feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
