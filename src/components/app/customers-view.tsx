"use client";

import { useCallback, useEffect, useRef, useState, type ElementType } from "react";
import { Archive as ArchiveIcon, ArchiveRestore, Download, Gift, Hourglass, Plus, Search, Tags as TagsIcon, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiDelete, apiGet, apiPatch, apiPost, downloadFile } from "@/lib/client/api";
import { formatDate, formatDateTime, formatINR, initials, sourceLabel, timeAgo } from "@/lib/client/format";
import type { AppCtx, CustomerListItem } from "@/lib/client/types";

// Local DTOs (mirrors of the API responses)
type CustomerListResponse = { items: CustomerListItem[]; nextCursor: string | null; hasMore: boolean };
type ConsentMap = { marketing?: boolean; email?: boolean; sms?: boolean; whatsapp?: boolean };
type ConsentState = { marketing: boolean; email: boolean; sms: boolean; whatsapp: boolean };

type CustomerDetail = {
  id: string; publicId: string; name: string; email: string; phone: string | null;
  birthdayYear?: number | null; birthdayMonth: number | null; birthdayDay: number | null;
  source: string; status: string; visitCount: number; totalSpendCents: number; pointsBalance: number;
  lastVisitAt: string | null; createdAt: string; consents: ConsentMap; notes: string | null;
  birthday: { month: number | null; day: number | null; daysUntil: number } | null;
  clvCents: number; feedbackAvg: number | null; feedbackCount: number; daysSinceLastVisit: number | null;
  isRepeat: boolean; isInactive: boolean;
  referralCode: { code: string; usesCount: number } | null;
  tags: { tag: { id: string; name: string; color: string } }[];
};

type TagDto = { id: string; name: string; color: string };
type SegmentRuleDto = { attr: string; op: string; value: string | number | (string | number)[] };
type SegmentDto = { id: string; name: string; description: string | null; rules: SegmentRuleDto[]; memberCount: number };
type TimelineEntry = { at: string; type: string; title: string; detail: string; tone?: string | null };
type MessageDto = {
  id: string; channel: string; kind: string; subject: string | null; body: string; status: string;
  attempts: number; lastError: string | null; createdAt: string; campaign: { id: string; name: string } | null;
};
type VisitResponse = {
  visit: { id: string; occurredAt: string; amountCents: number };
  loyalty: { balanceAfter: number; points: number; duplicate: boolean } | null;
};

const PAGE_SIZE = 25;
const SOURCES = ["walk_in", "referral", "instagram", "google", "website", "campaign"];
const ATTR_OPTIONS = [
  { value: "visitCount", label: "Visit count" },
  { value: "totalSpendCents", label: "Lifetime spend (cents)" },
  { value: "lastVisitDaysAgo", label: "Days since last visit" },
  { value: "birthdayMonth", label: "Birthday month (1-12)" },
  { value: "pointsBalance", label: "Points balance" },
  { value: "feedbackAvg", label: "Feedback average" },
  { value: "source", label: "Source" },
  { value: "status", label: "Status" },
  { value: "tag", label: "Tag" },
];
const NUMERIC_ATTRS = ["visitCount", "totalSpendCents", "lastVisitDaysAgo", "birthdayMonth", "pointsBalance", "feedbackAvg"];
const OP_OPTIONS = [
  { value: "eq", label: "equals" }, { value: "neq", label: "not equals" }, { value: "gte", label: "at least" },
  { value: "lte", label: "at most" }, { value: "between", label: "between" },
];

function birthdayInputValue(c: { birthdayYear?: number | null; birthdayMonth: number | null; birthdayDay: number | null }): string {
  if (!c.birthdayMonth || !c.birthdayDay) return "";
  const year = c.birthdayYear ?? new Date().getFullYear();
  return `${year}-${String(c.birthdayMonth).padStart(2, "0")}-${String(c.birthdayDay).padStart(2, "0")}`;
}

function ruleValueText(value: string | number | (string | number)[]): string {
  return Array.isArray(value) ? value.join(",") : String(value);
}

function toneBorder(tone?: string | null): string {
  if (tone === "positive") return "border-emerald-500";
  if (tone === "negative") return "border-rose-500";
  return "border-border";
}

function messageStatusClass(status: string): string {
  switch (status) {
    case "delivered": case "read": return "border-emerald-600 text-emerald-700";
    case "failed": return "border-rose-600 text-rose-700";
    case "queued": case "sent": return "border-amber-600 text-amber-700";
    default: return "";
  }
}

function Chip({ label, active, onClick, icon: Icon }: { label: string; active: boolean; onClick: () => void; icon?: ElementType }) {
  return (
    <Badge
      role="button" tabIndex={0} aria-pressed={active} variant={active ? "default" : "outline"}
      className={`cursor-pointer select-none gap-1.5 px-3 py-1.5 text-xs ${
        active ? "border-transparent bg-[var(--brand)] text-white" : "text-muted-foreground hover:bg-accent"
      }`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main view: filters + cursor-paginated table + segments panel
// ---------------------------------------------------------------------------

export default function CustomersView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("active");
  const [birthdayChip, setBirthdayChip] = useState(false);
  const [inactiveChip, setInactiveChip] = useState(false);

  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const [segments, setSegments] = useState<SegmentDto[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);

  // 400ms debounce on the search box
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filterParams = useCallback((cursor?: string | null) => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) p.set("cursor", cursor);
    if (search) p.set("search", search);
    if (segmentId) p.set("segmentId", segmentId);
    if (source) p.set("source", source);
    if (status !== "all") p.set("status", status);
    if (birthdayChip) p.set("birthdayWithinDays", "14");
    if (inactiveChip) p.set("inactiveWithinDays", "45");
    return p;
  }, [search, segmentId, source, status, birthdayChip, inactiveChip]);

  const fetchPage = useCallback(async (cursor: string | null, mode: "replace" | "append" | "silent") => {
    const seq = ++requestSeq.current;
    if (mode === "replace") setLoading(true);
    if (mode === "append") setLoadingMore(true);
    try {
      const res = await apiGet<CustomerListResponse>(`/api/customers?${filterParams(cursor).toString()}`);
      if (seq !== requestSeq.current) return;
      setItems((prev) => (mode === "append" ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setListError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = (err as Error).message;
      if (mode !== "silent") {
        setListError(message);
        toast({ title: "Could not load customers", description: message, variant: "destructive" });
      }
    } finally {
      if (seq === requestSeq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [filterParams, toast]);

  // any filter change refetches from scratch (cursor reset)
  useEffect(() => { void fetchPage(null, "replace"); }, [fetchPage]);

  const loadMore = () => { if (nextCursor && !loadingMore) void fetchPage(nextCursor, "append"); };
  const refreshSilently = useCallback(() => { void fetchPage(null, "silent"); }, [fetchPage]);

  const loadSegments = useCallback(async () => {
    setSegmentsLoading(true);
    try {
      const res = await apiGet<{ segments: SegmentDto[] }>("/api/segments");
      setSegments(res.segments);
    } catch (err) {
      toast({ title: "Could not load segments", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSegmentsLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadSegments(); }, [loadSegments]);

  const deleteSegment = async (seg: SegmentDto) => {
    try {
      await apiDelete(`/api/segments?id=${encodeURIComponent(seg.id)}`);
      toast({ title: "Segment deleted", description: `${seg.name} was removed from the rules engine` });
      if (segmentId === seg.id) setSegmentId("");
      void loadSegments();
    } catch (err) {
      toast({ title: "Could not delete segment", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <Badge variant="secondary" className="tabular-nums">{loading ? "…" : `${items.length}${hasMore ? "+" : ""}`}</Badge>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => downloadFile("/api/export/customers", `customers-${ctx.tenant.slug}.csv`)}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => setSegmentOpen(true)}>
            <TagsIcon className="h-4 w-4" /> New segment
          </Button>
          <Button className="h-10 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add customer
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search customers by name, email or phone" className="h-10 pl-9" placeholder="Search name, email or phone" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Select value={segmentId || "all"} onValueChange={(v) => setSegmentId(v === "all" ? "" : v)}>
          <SelectTrigger aria-label="Filter by segment" className="h-10 w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All segments</SelectItem>
            {segments.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.memberCount})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source || "all"} onValueChange={(v) => setSource(v === "all" ? "" : v)}>
          <SelectTrigger aria-label="Filter by source" className="h-10 w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {SOURCES.map((s) => <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="h-10 w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="archived">Archived only</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2">
          <Chip label="Birthdays ≤14d" icon={Gift} active={birthdayChip} onClick={() => setBirthdayChip(!birthdayChip)} />
          <Chip label="Inactive 45d+" icon={Hourglass} active={inactiveChip} onClick={() => setInactiveChip(!inactiveChip)} />
        </div>
      </div>

      {/* Main area: table + segments panel */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          {listError && (
            <Alert variant="destructive">
              <AlertTitle>Could not load customers</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span className="flex-1">{listError}</span>
                <Button size="sm" variant="outline" onClick={() => void fetchPage(null, "replace")}>Retry</Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Tags</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Lifetime value</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Points</TableHead>
                  <TableHead className="hidden lg:table-cell">Last visit</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}><TableCell colSpan={7}><Skeleton className="h-9 w-full" /></TableCell></TableRow>
                  ))
                ) : items.length ? (
                  items.map((c) => <CustomerRow key={c.id} customer={c} onOpen={() => setDetailId(c.id)} />)
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">No customers match the current filters.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card Stack */}
          <div className="block md:hidden space-y-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={`sk-m-${i}`} className="p-3.5">
                  <Skeleton className="h-12 w-full" />
                </Card>
              ))
            ) : items.length ? (
              items.map((c) => (
                <Card
                  key={`m-${c.id}`}
                  className="p-3.5 cursor-pointer hover:border-[var(--brand)] transition-colors active:bg-muted/50"
                  onClick={() => setDetailId(c.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">
                          {initials(c.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.email || c.phone || "No contact"}</div>
                      </div>
                    </div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                      {c.status}
                    </Badge>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
                    <span className="text-muted-foreground">{c.visitCount} visits</span>
                    <span className="font-semibold text-foreground">{formatINR(c.totalSpendCents)}</span>
                  </div>

                  {c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <Badge key={t.tag.id} variant="outline" className="text-[10px]" style={{ color: t.tag.color, borderColor: t.tag.color }}>
                          {t.tag.name}
                        </Badge>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </Card>
              ))
            ) : (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No customers match the current filters.
              </Card>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Cursor-paginated — no offset scans · showing {items.length}{hasMore ? "+" : ""} customers</p>
            {hasMore && (
              <Button variant="outline" className="h-10" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : `Load ${PAGE_SIZE} more`}
              </Button>
            )}
          </div>
        </div>

        <SegmentsPanel
          segments={segments} loading={segmentsLoading} activeSegmentId={segmentId}
          onToggle={(id) => setSegmentId(segmentId === id ? "" : id)}
          onDelete={deleteSegment}
          onNew={() => setSegmentOpen(true)}
        />
      </div>

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => void fetchPage(null, "replace")} />
      <SegmentBuilderDialog open={segmentOpen} onOpenChange={setSegmentOpen} onCreated={() => void loadSegments()} />
      <CustomerDrawer customerId={detailId} onClose={() => setDetailId(null)} onChanged={refreshSilently} />
    </div>
  );
}

function CustomerRow({ customer, onOpen }: { customer: CustomerListItem; onOpen: () => void }) {
  return (
    <TableRow
      className="cursor-pointer" tabIndex={0} aria-label={`Open profile for ${customer.name}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">{initials(customer.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">{customer.name}</div>
            <div className="truncate text-xs text-muted-foreground">{customer.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {customer.tags.length ? (
          <div className="flex max-w-[180px] flex-wrap gap-1">
            {customer.tags.slice(0, 3).map((t) => (
              <Badge key={t.tag.id} variant="outline" className="text-[10px]" style={{ color: t.tag.color, borderColor: t.tag.color }}>{t.tag.name}</Badge>
            ))}
            {customer.tags.length > 3 && <span className="text-[10px] leading-4 text-muted-foreground">+{customer.tags.length - 3}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{customer.visitCount}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">{formatINR(customer.totalSpendCents)}</TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">{customer.pointsBalance}</TableCell>
      <TableCell className="hidden lg:table-cell">{formatDate(customer.lastVisitAt)}</TableCell>
      <TableCell className="hidden md:table-cell"><Badge variant="secondary" className="text-[10px]">{sourceLabel(customer.source)}</Badge></TableCell>
    </TableRow>
  );
}

// Segments panel (right column, hidden on mobile)
function SegmentsPanel({ segments, loading, activeSegmentId, onToggle, onDelete, onNew }: {
  segments: SegmentDto[]; loading: boolean; activeSegmentId: string;
  onToggle: (id: string) => void; onDelete: (segment: SegmentDto) => void; onNew: () => void;
}) {
  return (
    <Card className="hidden w-72 shrink-0 lg:flex">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><TagsIcon className="h-4 w-4 text-[var(--brand)]" /> Segments</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Create a new segment" onClick={onNew}><Plus className="h-4 w-4" /></Button>
        </CardTitle>
        <CardDescription className="text-xs">Membership is computed live from the rules — nothing is stored.</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : segments.length ? (
          <div className="space-y-2">
            {segments.map((s) => (
              <div key={s.id} className={`rounded-lg border p-3 ${activeSegmentId === s.id ? "border-[var(--brand)] bg-[var(--brand)]/5" : ""}`}>
                <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => onToggle(s.id)}>
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge variant={activeSegmentId === s.id ? "default" : "secondary"}
                    className={`text-[10px] tabular-nums ${activeSegmentId === s.id ? "border-transparent bg-[var(--brand)] text-white" : ""}`}>
                    {s.memberCount}
                  </Badge>
                </button>
                {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                <div className="mt-1.5 space-y-0.5">
                  {s.rules.map((r, i) => (
                    <p key={i} className="font-mono text-[10px] text-muted-foreground">{r.attr} {r.op} {ruleValueText(r.value)}</p>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-1.5 h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => onDelete(s)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete segment
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No segments yet — build one from the rules engine.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Customer detail drawer (Sheet): profile | timeline | messages
function CustomerDrawer({ customerId, onClose, onChanged }: { customerId: string | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", phone: "", birthday: "", notes: "" });
  const [consent, setConsent] = useState<ConsentState>({ marketing: false, email: false, sms: false, whatsapp: false });
  const [savingProfile, setSavingProfile] = useState(false);

  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [savingTags, setSavingTags] = useState(false);

  const [visitOpen, setVisitOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [savingVisit, setSavingVisit] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ customer: CustomerDetail }>(`/api/customers/${customerId}`);
      const c = res.customer;
      setDetail(c);
      setForm({ name: c.name, email: c.email, phone: c.phone ?? "", birthday: birthdayInputValue(c), notes: c.notes ?? "" });
      setConsent({ marketing: !!c.consents?.marketing, email: !!c.consents?.email, sms: !!c.consents?.sms, whatsapp: !!c.consents?.whatsapp });
      setSelectedTagIds(c.tags.map((t) => t.tag.id));
    } catch (err) {
      setError((err as Error).message);
      toast({ title: "Could not load customer", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [customerId, toast]);

  // clearing stale data avoids flashing the previous customer while the new one loads
  useEffect(() => {
    if (!customerId) return;
    setDetail((prev) => (prev && prev.id === customerId ? prev : null));
    void loadDetail();
  }, [customerId, loadDetail]);

  useEffect(() => {
    if (!customerId) return;
    apiGet<{ tags: TagDto[] }>("/api/tags").then((res) => setAllTags(res.tags)).catch(() => setAllTags([]));
  }, [customerId]);

  const saveProfile = async () => {
    if (!detail) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {};
    if (form.name.trim() !== detail.name) payload.name = form.name.trim();
    if (form.email.trim() !== detail.email) payload.email = form.email.trim();
    if (form.phone.trim() !== (detail.phone ?? "")) payload.phone = form.phone.trim();
    if (form.birthday !== birthdayInputValue(detail)) payload.birthday = form.birthday.trim();
    if (form.notes !== (detail.notes ?? "")) payload.notes = form.notes;
    if ((["marketing", "email", "sms", "whatsapp"] as const).some((k) => consent[k] !== !!detail.consents?.[k])) payload.consents = { ...consent };
    if (Object.keys(payload).length === 0) {
      toast({ title: "Nothing to save", description: "No profile changes detected." });
      return;
    }
    setSavingProfile(true);
    try {
      await apiPatch(`/api/customers/${detail.id}`, payload);
      toast({ title: "Profile saved" });
      await loadDetail();
      onChanged();
    } catch (err) {
      toast({ title: "Could not save profile", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const addTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const res = await apiPost<{ tag: TagDto }>("/api/tags", { name });
      setAllTags((prev) => [...prev, res.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTagIds((prev) => (prev.includes(res.tag.id) ? prev : [...prev, res.tag.id]));
      setNewTagName("");
      toast({ title: "Tag created", description: `"${res.tag.name}" is checked — save tags to apply it` });
    } catch (err) {
      toast({ title: "Could not create tag", description: (err as Error).message, variant: "destructive" });
    }
  };

  const saveTags = async () => {
    if (!detail) return;
    const previousTags = [...selectedTagIds];
    const previousDetailTags = detail.tags;

    // Optimistically update local detail view
    const optimisticTags = selectedTagIds.map((id) => {
      const found = allTags.find((t) => t.id === id);
      return { tag: { id, name: found?.name ?? "Tag", color: found?.color ?? "#0f766e" } };
    });
    setDetail({ ...detail, tags: optimisticTags });

    setSavingTags(true);
    try {
      await apiPost(`/api/customers/${detail.id}/tags`, { tagIds: selectedTagIds });
      toast({ title: "Tags updated", description: `${selectedTagIds.length} tag${selectedTagIds.length === 1 ? "" : "s"} assigned` });
      await loadDetail();
      onChanged();
    } catch (err) {
      // Rollback optimistic update
      setSelectedTagIds(previousTags);
      setDetail((d) => (d ? { ...d, tags: previousDetailTags } : d));
      toast({ title: "Could not save tags", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingTags(false);
    }
  };

  const setArchived = async (next: boolean) => {
    if (!detail) return;
    const previousStatus = detail.status;

    // Optimistic UI update
    setDetail({ ...detail, status: next ? "archived" : "active" });

    try {
      await apiPatch(`/api/customers/${detail.id}`, { status: next ? "archived" : "active" });
      toast({ title: next ? "Customer archived" : "Customer restored", description: next ? "Hidden from active lists and audiences" : "Back in active lists and audiences" });
      await loadDetail();
      onChanged();
    } catch (err) {
      // Rollback optimistic state
      setDetail((d) => (d ? { ...d, status: previousStatus } : d));
      toast({ title: "Could not update status", description: (err as Error).message, variant: "destructive" });
    }
  };

  const recordVisit = async () => {
    if (!detail) return;
    const rupees = Number(amount);
    if (amount === "" || !Number.isFinite(rupees) || rupees < 0) {
      toast({ title: "Enter a valid amount", description: "Amount in rupees, e.g. 450", variant: "destructive" });
      return;
    }
    setSavingVisit(true);
    try {
      const res = await apiPost<VisitResponse>(`/api/customers/${detail.id}/visits`, { amountRupees: rupees, note: note.trim() || null });
      const loy = res.loyalty;
      toast({
        title: loy ? `Visit recorded — +${loy.points} pts (balance ${loy.balanceAfter})` : "Visit recorded",
        description: loy?.duplicate
          ? "Loyalty credit skipped — points for this visit were already applied"
          : `Amount recorded: ${formatINR(Math.round(rupees * 100))} · visit event queued`,
      });
      setVisitOpen(false);
      setAmount("");
      setNote("");
      await loadDetail();
      onChanged();
    } catch (err) {
      toast({ title: "Could not record visit", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingVisit(false);
    }
  };

  return (
    <Sheet open={customerId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        {loading && !detail ? (
          <div className="space-y-4 p-4">
            <SheetTitle className="sr-only">Loading customer profile</SheetTitle>
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="space-y-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-56" /></div>
            </div>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : error && !detail ? (
          <div className="p-4">
            <SheetTitle className="sr-only">Customer could not be loaded</SheetTitle>
            <Alert variant="destructive">
              <AlertTitle>Could not load this customer</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : detail ? (
          <>
            <SheetHeader className="pb-3">
              <div className="flex items-start gap-3 pr-8">
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarFallback className="bg-[var(--brand)] text-sm font-semibold text-white">{initials(detail.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{detail.name}</SheetTitle>
                  <SheetDescription className="truncate">{detail.email}{detail.phone ? ` · ${detail.phone}` : ""}</SheetDescription>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.isRepeat && <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700">Repeat customer</Badge>}
                    {detail.isInactive && <Badge variant="outline" className="border-amber-600 bg-amber-600/10 text-[10px] text-amber-700">Inactive</Badge>}
                    {detail.birthday && <Badge variant="outline" className="border-[var(--brand)] text-[10px] text-[var(--brand)]">Birthday in {detail.birthday.daysUntil}d</Badge>}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
              {[
                { label: "Visits", value: String(detail.visitCount) },
                { label: "Lifetime value", value: formatINR(detail.clvCents) },
                { label: "Points balance", value: String(detail.pointsBalance) },
                { label: "Feedback avg", value: detail.feedbackAvg ? `${detail.feedbackAvg} / 5` : "—" },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border p-2 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
                  <div className="truncate text-sm font-semibold tabular-nums">{k.value}</div>
                </div>
              ))}
            </div>

            <Tabs defaultValue="profile" className="min-h-0 flex-1 px-4">
              <TabsList className="w-full">
                <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
                <TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger>
                <TabsTrigger value="messages" className="flex-1">Messages</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="c-name">Name</Label>
                      <Input id="c-name" className="h-10" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-email">Email</Label>
                      <Input id="c-email" type="email" className="h-10" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-phone">Phone</Label>
                      <Input id="c-phone" className="h-10" placeholder="Optional" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-birthday">Birthday</Label>
                      <Input id="c-birthday" type="date" className="h-10" value={form.birthday} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-notes">Notes</Label>
                    <Textarea id="c-notes" rows={3} placeholder="Preferences, allergies, staff notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Marketing consents</p>
                  <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {(["marketing", "email", "sms", "whatsapp"] as const).map((k) => (
                      <div key={k} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <Label htmlFor={`consent-${k}`} className="text-sm">{k === "sms" ? "SMS" : k === "whatsapp" ? "WhatsApp" : k.charAt(0).toUpperCase() + k.slice(1)}</Label>
                        <Switch id={`consent-${k}`} checked={consent[k]} onCheckedChange={(v) => setConsent((c) => ({ ...c, [k]: v }))} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button className="h-10 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" disabled={savingProfile} onClick={() => void saveProfile()}>
                    {savingProfile ? "Saving…" : "Save profile"}
                  </Button>
                  {detail.referralCode && (
                    <span className="text-xs text-muted-foreground">
                      Referral code <span className="font-mono">{detail.referralCode.code}</span> · {detail.referralCode.usesCount} uses
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">ID {detail.publicId}</span>
                </div>

                {/* Tag editor */}
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Tags</p>
                    <span className="text-[11px] text-muted-foreground">{selectedTagIds.length} selected</span>
                  </div>
                  {allTags.length ? (
                    <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                      {allTags.map((t) => (
                        <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                          <Checkbox
                            checked={selectedTagIds.includes(t.id)}
                            onCheckedChange={(v) => setSelectedTagIds((prev) => (v ? [...prev, t.id] : prev.filter((id) => id !== t.id)))}
                          />
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                          <span className="truncate">{t.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No tags defined yet — create the first one below.</p>
                  )}
                  <div className="flex gap-2">
                    <Input aria-label="New tag name" className="h-10" placeholder="New tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} />
                    <Button variant="outline" className="h-10 shrink-0" onClick={() => void addTag()}>Add tag</Button>
                  </div>
                  <Button variant="outline" className="h-10 w-full" disabled={savingTags} onClick={() => void saveTags()}>
                    {savingTags ? "Saving…" : "Save tags"}
                  </Button>
                </div>

                {/* Archive / restore */}
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Account status</p>
                  <p className="mt-1 text-sm">
                    {detail.status === "archived"
                      ? "This customer is archived — hidden from active lists and audiences."
                      : "Active — included in lists, segments and campaign audiences."}
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="mt-2 h-10 gap-1.5">
                        {detail.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <ArchiveIcon className="h-4 w-4" />}
                        {detail.status === "archived" ? "Restore customer" : "Archive customer"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{detail.status === "archived" ? "Restore this customer?" : "Archive this customer?"}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {detail.status === "archived"
                            ? "They will reappear in active lists, segments and campaign audiences."
                            : "Archived customers are kept for records but excluded from active lists and audiences. You can restore anytime."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void setArchived(detail.status !== "archived")}>
                          {detail.status === "archived" ? "Restore" : "Archive"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TabsContent>

              <TabsContent value="timeline" className="min-h-0 flex-1"><TimelineTab customerId={detail.id} /></TabsContent>
              <TabsContent value="messages" className="min-h-0 flex-1"><MessagesTab customerId={detail.id} /></TabsContent>
            </Tabs>

            <SheetFooter className="border-t">
              <Button className="h-10 w-full gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={() => setVisitOpen(true)}>
                <Plus className="h-4 w-4" /> Record visit
              </Button>
            </SheetFooter>

            {/* Record visit dialog */}
            <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Record visit</DialogTitle>
                  <DialogDescription>The amount feeds lifetime value, loyalty points and the follow-up journey automatically.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="visit-amount">Amount (rupees)</Label>
                    <Input id="visit-amount" type="number" min={0} inputMode="decimal" className="h-10" placeholder="e.g. 450" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="visit-note">Note (optional)</Label>
                    <Input id="visit-note" className="h-10" placeholder="Service, staff, remarks" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" className="h-10" onClick={() => setVisitOpen(false)}>Cancel</Button>
                  <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={savingVisit} onClick={() => void recordVisit()}>
                    {savingVisit ? "Recording…" : "Record visit"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TimelineTab({ customerId }: { customerId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => apiGet<{ timeline: TimelineEntry[] }>(`/api/customers/${customerId}/timeline`))
      .then((res) => { if (active) setEntries(res.timeline); })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [customerId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load timeline</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!entries) {
    return <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  }
  if (!entries.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nothing on the timeline yet — record a visit or log feedback.</p>;
  }
  return (
    <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
      {entries.map((e, i) => (
        <div key={i} className={`rounded-r-md border-l-2 pl-3 ${toneBorder(e.tone)}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{e.type}</span>
            <span className="text-[11px] text-muted-foreground">{formatDateTime(e.at)}</span>
          </div>
          <p className="text-sm font-medium">{e.title}</p>
          {e.detail && <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function MessagesTab({ customerId }: { customerId: string }) {
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => apiGet<{ messages: MessageDto[] }>(`/api/campaigns?messages=1&customerId=${encodeURIComponent(customerId)}`))
      .then((res) => { if (active) setMessages(res.messages); })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [customerId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load messages</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!messages) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (!messages.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No messages sent to this customer yet.</p>;
  }
  return (
    <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
      {messages.map((m) => (
        <div key={m.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] uppercase">{m.channel}</Badge>
            <Badge variant="outline" className={`text-[10px] ${messageStatusClass(m.status)}`}>{m.status}</Badge>
            {m.campaign && <span className="truncate text-[11px] text-muted-foreground">{m.campaign.name}</span>}
            <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(m.createdAt)}</span>
          </div>
          {m.subject && <p className="mt-1.5 line-clamp-1 text-sm font-medium">{m.subject}</p>}
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
          {m.status === "failed" && m.lastError && (
            <p className="mt-1 text-[11px] text-rose-600">{m.lastError}{m.attempts > 1 ? ` — ${m.attempts} attempts` : ""}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Add customer dialog (manual staff entry)
function AddCustomerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [source, setSource] = useState("walk_in");
  const [emailOk, setEmailOk] = useState(true);
  const [smsOk, setSmsOk] = useState(false);
  const [whatsappOk, setWhatsappOk] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(""); setEmail(""); setPhone(""); setBirthday(""); setSource("walk_in");
    setEmailOk(true); setSmsOk(false); setWhatsappOk(false); setNotes("");
  }, [open]);

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ customer: { id: string; publicId: string } }>("/api/customers", {
        name: name.trim(), email: email.trim(), phone: phone.trim() || null, birthday: birthday || null,
        source, notes: notes.trim() || null, consents: { email: emailOk, sms: smsOk, whatsapp: whatsappOk },
      });
      toast({
        title: "Customer created — registration event queued",
        description: `The welcome journey starts on the next worker tick · public ID ${res.customer.publicId}`,
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({ title: "Could not create customer", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Manual staff entry — the registration event is written to the transactional outbox together with the row.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Name</Label>
              <Input id="add-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email">Email</Label>
              <Input id="add-email" type="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone">Phone</Label>
              <Input id="add-phone" className="h-10" placeholder="Optional" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-birthday">Birthday</Label>
              <Input id="add-birthday" type="date" className="h-10" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-source">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="add-source" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Consents at signup</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={emailOk} onCheckedChange={(v) => setEmailOk(v === true)} /> Email</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={smsOk} onCheckedChange={(v) => setSmsOk(v === true)} /> SMS</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={whatsappOk} onCheckedChange={(v) => setWhatsappOk(v === true)} /> WhatsApp</label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-notes">Notes</Label>
            <Textarea id="add-notes" rows={3} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving} onClick={() => void submit()}>
            {saving ? "Creating…" : "Create customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// New segment dialog (rule builder)
type RuleDraft = { attr: string; op: string; value: string };

function SegmentBuilderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([{ attr: "visitCount", op: "gte", value: "1" }]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setRules([{ attr: "visitCount", op: "gte", value: "1" }]);
    apiGet<{ tags: TagDto[] }>("/api/tags").then((res) => setTags(res.tags)).catch(() => setTags([]));
  }, [open]);

  // point tag rules at a real tag once options are known
  useEffect(() => {
    setRules((prev) => prev.map((r) => (r.attr === "tag" && !r.value && tags.length ? { ...r, value: tags[0].id } : r)));
  }, [tags]);

  const updateRule = (index: number, patch: Partial<RuleDraft>) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (patch.attr !== undefined && patch.attr !== r.attr) {
          next.value = patch.attr === "tag" ? (tags[0]?.id ?? "") : "";
          if (["source", "status", "tag"].includes(next.attr) && !["eq", "neq"].includes(next.op)) next.op = "eq";
        }
        return next;
      })
    );
  };

  const removeRule = (index: number) => setRules((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: "Segment name is required", variant: "destructive" });
      return;
    }
    const payloadRules: SegmentRuleDto[] = [];
    for (const r of rules) {
      const raw = r.value.trim();
      if (!raw) {
        toast({ title: "Missing rule value", description: `Set a value for the ${r.attr} rule`, variant: "destructive" });
        return;
      }
      if (r.attr === "tag") {
        payloadRules.push({ attr: r.attr, op: r.op, value: [raw] });
      } else if (r.op === "between") {
        const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length !== 2) {
          toast({ title: "Between needs two bounds", description: 'Use the "min,max" format, e.g. 20,60', variant: "destructive" });
          return;
        }
        payloadRules.push({ attr: r.attr, op: r.op, value: parts });
      } else if (NUMERIC_ATTRS.includes(r.attr)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          toast({ title: "Numeric rule", description: `${r.attr} needs a number`, variant: "destructive" });
          return;
        }
        payloadRules.push({ attr: r.attr, op: r.op, value: n });
      } else {
        payloadRules.push({ attr: r.attr, op: r.op, value: raw });
      }
    }
    setSaving(true);
    try {
      await apiPost("/api/segments", { name: name.trim(), description: description.trim() || null, rules: payloadRules });
      toast({ title: "Segment created", description: "Membership is recomputed live by the segmentation engine" });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({ title: "Could not create segment", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>Rules run against live customer attributes — no membership rows are stored.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="seg-name">Name</Label>
              <Input id="seg-name" className="h-10" placeholder="e.g. VIP regulars" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-desc">Description</Label>
              <Input id="seg-desc" className="h-10" placeholder="Optional, shown in the segments panel" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Rules (all must match)</Label>
            {rules.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] items-center gap-2 sm:grid-cols-[9rem_8rem_1fr_2.75rem]">
                <Select value={r.attr} onValueChange={(v) => updateRule(i, { attr: v })}>
                  <SelectTrigger aria-label="Rule attribute" className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTR_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={r.op} onValueChange={(v) => updateRule(i, { op: v })}>
                  <SelectTrigger aria-label="Rule operator" className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OP_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {r.attr === "tag" ? (
                  <Select value={r.value} onValueChange={(v) => updateRule(i, { value: v })}>
                    <SelectTrigger aria-label="Tag for the rule" className="col-span-2 h-10 w-full sm:col-span-1"><SelectValue placeholder="Pick a tag" /></SelectTrigger>
                    <SelectContent>
                      {tags.length ? (
                        tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)
                      ) : (
                        <SelectItem value="none" disabled>No tags yet</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    aria-label="Rule value" className="col-span-2 h-10 sm:col-span-1"
                    placeholder={r.op === "between" ? "min,max — e.g. 20,60" : NUMERIC_ATTRS.includes(r.attr) ? "number" : "value"}
                    value={r.value} onChange={(e) => updateRule(i, { value: e.target.value })}
                  />
                )}
                <Button type="button" variant="ghost" size="icon" className="col-span-2 h-10 w-full sm:col-span-1 sm:w-11"
                  disabled={rules.length === 1} onClick={() => removeRule(i)} aria-label="Remove rule">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="h-10 w-full gap-1.5" onClick={() => setRules((prev) => [...prev, { attr: "visitCount", op: "gte", value: "1" }])}>
              <Plus className="h-4 w-4" /> Add rule
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving} onClick={() => void submit()}>
            {saving ? "Creating…" : "Create segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
