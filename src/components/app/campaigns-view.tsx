"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Download,
  Gift,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  Ticket,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost, downloadFile } from "@/lib/client/api";
import { formatDate, formatDateTime, timeAgo } from "@/lib/client/format";
import type { AppCtx, CustomerListItem, CustomerListResponse } from "@/lib/client/types";

/* ---------- DTOs (mirrors of the API responses) ---------- */

type ChannelId = "email" | "sms" | "whatsapp";
type CampaignStatus = "draft" | "scheduled" | "running" | "completed" | "cancelled";

type Campaign = {
  id: string;
  name: string;
  channel: ChannelId;
  status: CampaignStatus;
  scheduledAt: string | null;
  completedAt: string | null;
  template: string;
  segmentName: string | null;
  total: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
};
type CampaignsResponse = { campaigns: Campaign[] };

type CampaignMessage = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  customer: { id: string; name: string } | null;
};
type MessagesResponse = { messages: CampaignMessage[] };

type SegmentRef = { id: string; name: string };

type OfferKind = "discount" | "birthday_greeting" | "points_bonus" | "custom";
type OfferStatus = "active" | "paused" | "expired";
type CouponRef = { id: string; code: string; status: string };
type Offer = {
  id: string;
  title: string;
  description: string | null;
  kind: OfferKind;
  value: number;
  channel: ChannelId;
  status: OfferStatus;
  startsAt: string;
  expiresAt: string | null;
  couponCount: number;
  redemptionCount: number;
  coupons: CouponRef[];
};
type OffersResponse = { offers: Offer[] };
type RedeemResult = { duplicate: boolean; redemptionId: string; couponCode: string | null; message: string };

type Coupon = {
  id: string;
  code: string;
  status: "active" | "redeemed" | "expired";
  pointsCost: number | null;
  expiresAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
  offer: { id: string; title: string; kind: string } | null;
  customer: { id: string; name: string } | null;
};
type CouponsResponse = { coupons: Coupon[] };

type CampaignDraft = {
  name: string;
  channel: ChannelId;
  segmentId: string;
  template: string;
  aiGoal: string;
  aiTone: string;
  scheduledAt: string;
};
type OfferDraft = {
  title: string;
  description: string;
  kind: OfferKind;
  value: string;
  channel: ChannelId;
  expiresAt: string;
  generateCoupons: string;
};

/* ---------- constants & pure helpers ---------- */

const OFFER_KINDS: OfferKind[] = ["discount", "birthday_greeting", "points_bonus", "custom"];
const AI_TONES = ["warm", "professional", "playful"] as const;
const COUPON_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "redeemed", label: "Redeemed" },
  { id: "expired", label: "Expired" },
] as const;

function emptyCampaignDraft(channel: ChannelId): CampaignDraft {
  return {
    name: "",
    channel,
    segmentId: "all",
    template: "",
    aiGoal: "",
    aiTone: "warm",
    scheduledAt: "",
  };
}

function emptyOfferDraft(channel: ChannelId): OfferDraft {
  return {
    title: "",
    description: "",
    kind: "discount",
    value: "10",
    channel,
    expiresAt: "",
    generateCoupons: "0",
  };
}

function campaignStatusBadge(status: CampaignStatus): { variant: "secondary" | "outline" | "default"; className: string } {
  switch (status) {
    case "draft":
      return { variant: "secondary", className: "text-[10px]" };
    case "scheduled":
      return { variant: "default", className: "bg-amber-600 border-transparent text-white text-[10px]" };
    case "running":
      return { variant: "outline", className: "border-amber-600 text-amber-700 text-[10px]" };
    case "completed":
      return { variant: "default", className: "bg-emerald-600 border-transparent text-white text-[10px]" };
    case "cancelled":
      return { variant: "secondary", className: "bg-muted text-muted-foreground text-[10px]" };
  }
}

function messageStatusClass(status: string): string {
  switch (status) {
    case "read":
      return "border-emerald-600 text-emerald-700";
    case "delivered":
      return "border-emerald-600/60 text-emerald-700";
    case "sent":
    case "queued":
      return "border-amber-600 text-amber-700";
    case "failed":
      return "border-rose-600 text-rose-700";
    default:
      return "text-muted-foreground";
  }
}

function offerStatusClass(status: OfferStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-600 border-transparent text-white";
    case "paused":
      return "bg-amber-600 border-transparent text-white";
    case "expired":
      return "bg-muted border-transparent text-muted-foreground";
  }
}

function couponStatusClass(status: Coupon["status"]): string {
  switch (status) {
    case "active":
      return "border-emerald-600 text-emerald-700";
    case "redeemed":
      return "bg-[var(--brand)] border-transparent text-white";
    case "expired":
      return "bg-muted border-transparent text-muted-foreground";
  }
}

function offerValueLabel(o: { kind: string; value: number }): string {
  switch (o.kind) {
    case "discount":
      return `${o.value}% off`;
    case "points_bonus":
      return `+${o.value} pts`;
    case "birthday_greeting":
      return "birthday treat";
    default:
      return String(o.value);
  }
}

/** ISO string -> value accepted by <input type="datetime-local"> (business-local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- view ---------- */

export default function CampaignsView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("campaigns");

  const channels = ctx.tenant.settings.channels;
  const enabledChannels = useMemo<ChannelId[]>(
    () => (Object.keys(channels) as ChannelId[]).filter((c) => channels[c].enabled),
    [channels]
  );

  /* Campaigns tab */
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [segments, setSegments] = useState<SegmentRef[]>([]);
  const [campLoading, setCampLoading] = useState(true);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    setCampLoading(true);
    try {
      const [c, w] = await Promise.all([
        apiGet<CampaignsResponse>("/api/campaigns"),
        apiGet<{ segments: SegmentRef[] }>("/api/workflows"),
      ]);
      setCampaigns(c.campaigns);
      setSegments(w.segments);
    } catch (err) {
      toast({ title: "Could not load campaigns", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCampLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const runCampaign = async (c: Campaign) => {
    setBusyCampaignId(c.id);
    try {
      await apiPost("/api/campaigns/run", { campaignId: c.id });
      toast({ title: "Campaign executed", description: `${c.name} finished — delivery stats refresh below.` });
      void loadCampaigns();
    } catch (err) {
      toast({ title: "Could not run campaign", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyCampaignId(null);
    }
  };

  const cancelCampaign = async (c: Campaign) => {
    setBusyCampaignId(c.id);
    try {
      await apiPatch("/api/campaigns", { campaignId: c.id, action: "cancel" });
      toast({ title: "Campaign cancelled", description: `${c.name} will not run.` });
      void loadCampaigns();
    } catch (err) {
      toast({ title: "Could not cancel campaign", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyCampaignId(null);
    }
  };

  /* Schedule dialog */
  const [scheduleFor, setScheduleFor] = useState<Campaign | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const openSchedule = (c: Campaign) => {
    setScheduleFor(c);
    setScheduleAt(toLocalInput(c.scheduledAt));
  };

  const submitSchedule = async () => {
    if (!scheduleFor) return;
    if (!scheduleAt) {
      toast({ title: "Pick a date and time", description: "The campaign needs a run time.", variant: "destructive" });
      return;
    }
    setScheduling(true);
    try {
      await apiPatch("/api/campaigns", { campaignId: scheduleFor.id, action: "schedule", scheduledAt: scheduleAt });
      toast({ title: "Scheduled — campaign.scheduled event queued", description: `${scheduleFor.name} runs ${formatDateTime(scheduleAt)}.` });
      setScheduleFor(null);
      void loadCampaigns();
    } catch (err) {
      toast({ title: "Could not schedule campaign", description: (err as Error).message, variant: "destructive" });
    } finally {
      setScheduling(false);
    }
  };

  /* Messages dialog */
  const [msgFor, setMsgFor] = useState<Campaign | null>(null);
  const [messages, setMessages] = useState<CampaignMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  const openMessages = useCallback(
    async (c: Campaign) => {
      setMsgFor(c);
      setMessages([]);
      setMsgLoading(true);
      try {
        const res = await apiGet<MessagesResponse>(`/api/campaigns?messages=1&campaignId=${encodeURIComponent(c.id)}`);
        setMessages(res.messages);
      } catch (err) {
        toast({ title: "Could not load messages", description: (err as Error).message, variant: "destructive" });
        setMsgFor(null);
      } finally {
        setMsgLoading(false);
      }
    },
    [toast]
  );

  /* New campaign dialog (with AI assist) */
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(() => emptyCampaignDraft(enabledChannels[0] ?? "email"));

  const openCreate = () => {
    setDraft(emptyCampaignDraft(enabledChannels[0] ?? "email"));
    setCreateOpen(true);
  };
  const upDraft = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const draftWithAi = async () => {
    if (!draft.aiGoal.trim()) {
      toast({ title: "Describe the goal first", description: "Tell the assistant what this message should achieve.", variant: "destructive" });
      return;
    }
    setAiBusy(true);
    try {
      const res = await apiPost<{ draft: string }>("/api/ai/draft-template", {
        goal: draft.aiGoal,
        tone: draft.aiTone,
        channel: draft.channel,
        audience: draft.segmentId === "all" ? "all active customers" : segments.find((s) => s.id === draft.segmentId)?.name ?? "existing customers",
      });
      upDraft({ template: res.draft });
      toast({ title: "AI draft inserted", description: "Review and edit the template below before saving." });
    } catch (err) {
      toast({
        title: (err as Error).message,
        description: "The composer below still works — write the message manually.",
        variant: "destructive",
      });
    } finally {
      setAiBusy(false);
    }
  };

  const createCampaign = async () => {
    if (!draft.name.trim() || !draft.template.trim()) {
      toast({ title: "Missing details", description: "A name and a message template are required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await apiPost("/api/campaigns", {
        name: draft.name.trim(),
        channel: draft.channel,
        template: draft.template.trim(),
        segmentId: draft.segmentId === "all" ? null : draft.segmentId,
        ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
      });
      toast({
        title: "Campaign created",
        description: draft.scheduledAt ? "Scheduled — the campaign.scheduled event is queued." : "Saved as a draft — run it or schedule it when ready.",
      });
      setCreateOpen(false);
      void loadCampaigns();
    } catch (err) {
      toast({ title: "Could not create campaign", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  /* Offers tab */
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);

  const loadOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const res = await apiGet<OffersResponse>("/api/offers");
      setOffers(res.offers);
    } catch (err) {
      toast({ title: "Could not load offers", description: (err as Error).message, variant: "destructive" });
    } finally {
      setOffersLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === "offers") void loadOffers();
  }, [tab, loadOffers]);

  /* Generate coupons dialog */
  const [genFor, setGenFor] = useState<Offer | null>(null);
  const [genCount, setGenCount] = useState("5");
  const [genBusy, setGenBusy] = useState(false);
  const [generated, setGenerated] = useState<{ id: string; code: string }[]>([]);

  const openGenerate = (o: Offer) => {
    setGenFor(o);
    setGenCount("5");
    setGenerated([]);
  };

  const generateCoupons = async () => {
    if (!genFor) return;
    const n = Number.parseInt(genCount, 10);
    if (!n || n < 1) {
      toast({ title: "Enter a count", description: "How many codes should be generated?", variant: "destructive" });
      return;
    }
    setGenBusy(true);
    try {
      const res = await apiPost<{ coupons: { id: string; code: string }[] }>(
        `/api/offers/${encodeURIComponent(genFor.id)}/coupons`,
        { count: Math.min(n, 200) }
      );
      setGenerated(res.coupons);
      toast({ title: `${res.coupons.length} coupons generated`, description: "Codes are listed below — share them with customers." });
      void loadOffers();
    } catch (err) {
      toast({ title: "Could not generate coupons", description: (err as Error).message, variant: "destructive" });
    } finally {
      setGenBusy(false);
    }
  };

  /* Redeem dialog */
  const [redeemFor, setRedeemFor] = useState<Offer | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<CustomerListItem[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState("none");
  const [redeemBusy, setRedeemBusy] = useState(false);

  const openRedeem = (o: Offer) => {
    setRedeemFor(o);
    setPickedId(null);
    setRedeemCode("none");
    setCustQuery("");
    setCustResults([]);
  };

  useEffect(() => {
    if (redeemFor === null) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setCustLoading(true);
      try {
        const res = await apiGet<CustomerListResponse>(
          `/api/customers?limit=20${custQuery ? `&search=${encodeURIComponent(custQuery)}` : ""}`
        );
        if (alive) setCustResults(res.items);
      } catch (err) {
        if (alive) toast({ title: "Could not search customers", description: (err as Error).message, variant: "destructive" });
      } finally {
        if (alive) setCustLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [custQuery, redeemFor, toast]);

  const submitRedeem = async () => {
    if (!redeemFor || !pickedId) {
      toast({ title: "Pick a customer first", description: "Search and select the customer being redeemed for.", variant: "destructive" });
      return;
    }
    setRedeemBusy(true);
    try {
      const res = await apiPost<RedeemResult>("/api/offers/redeem", {
        offerId: redeemFor.id,
        customerId: pickedId,
        ...(redeemCode !== "none" ? { couponCode: redeemCode } : {}),
      });
      toast({
        title: res.duplicate ? "Idempotent guard: already redeemed" : "Redeemed",
        description: res.message,
      });
      setRedeemFor(null);
      void loadOffers();
    } catch (err) {
      toast({ title: "Redemption failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRedeemBusy(false);
    }
  };

  /* New offer dialog */
  const [offerCreateOpen, setOfferCreateOpen] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(() => emptyOfferDraft(enabledChannels[0] ?? "email"));

  const openOfferCreate = () => {
    setOfferDraft(emptyOfferDraft(enabledChannels[0] ?? "email"));
    setOfferCreateOpen(true);
  };
  const upOfferDraft = (patch: Partial<OfferDraft>) => setOfferDraft((d) => ({ ...d, ...patch }));

  const createOffer = async () => {
    if (!offerDraft.title.trim()) {
      toast({ title: "Missing title", description: "Give the offer a short, customer-facing title.", variant: "destructive" });
      return;
    }
    setOfferBusy(true);
    try {
      const gen = Math.max(0, Number.parseInt(offerDraft.generateCoupons, 10) || 0);
      await apiPost("/api/offers", {
        title: offerDraft.title.trim(),
        description: offerDraft.description.trim() || null,
        kind: offerDraft.kind,
        value: Math.max(0, Number.parseInt(offerDraft.value, 10) || 0),
        channel: offerDraft.channel,
        ...(offerDraft.expiresAt ? { expiresAt: offerDraft.expiresAt } : {}),
        ...(gen > 0 ? { generateCoupons: gen } : {}),
      });
      toast({ title: "Offer created — offer.created event queued", description: "The outbox will process the event on the next worker tick." });
      setOfferCreateOpen(false);
      void loadOffers();
    } catch (err) {
      toast({ title: "Could not create offer", description: (err as Error).message, variant: "destructive" });
    } finally {
      setOfferBusy(false);
    }
  };

  /* Coupons tab */
  const [couponFilter, setCouponFilter] = useState<string>("all");
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [couponsLoading, setCouponsLoading] = useState(false);

  const loadCoupons = useCallback(
    async (status: string) => {
      setCouponsLoading(true);
      try {
        const suffix = status === "all" ? "" : `?status=${status}`;
        const res = await apiGet<CouponsResponse>(`/api/offers/redeem${suffix}`);
        setCoupons(res.coupons);
      } catch (err) {
        toast({ title: "Could not load coupons", description: (err as Error).message, variant: "destructive" });
      } finally {
        setCouponsLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (tab === "coupons") void loadCoupons(couponFilter);
  }, [tab, couponFilter, loadCoupons]);

  const activeCouponsOf = (o: Offer) => o.coupons.filter((c) => c.status === "active");

  const campaignList = campaigns ?? [];

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns &amp; Offers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Broadcasts, targeted offers and coupon redemptions — delivered through the outbox
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => downloadFile("/api/export/campaigns", `campaigns-${ctx.tenant.slug}.csv`)}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="campaigns" className="whitespace-nowrap">Campaigns</TabsTrigger>
          <TabsTrigger value="offers" className="whitespace-nowrap">Offers</TabsTrigger>
          <TabsTrigger value="coupons" className="whitespace-nowrap">Coupons</TabsTrigger>
        </TabsList>

        {/* ---------- TAB 1: campaigns ---------- */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={campLoading} onClick={() => void loadCampaigns()}>
              <RefreshCw className={`h-3.5 w-3.5 ${campLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" className="ml-auto gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </div>

          {campLoading && !campaigns ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="space-y-3 p-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-7 w-40" />
                </Card>
              ))}
            </div>
          ) : campaignList.length > 0 ? (
            <div className="space-y-4">
              {campaignList.map((c) => {
                const sb = campaignStatusBadge(c.status);
                const pct = c.total > 0 ? Math.round((c.delivered / c.total) * 100) : 0;
                const stats: { label: string; value: number; dot: string }[] = [
                  { label: "total", value: c.total, dot: "bg-muted-foreground/50" },
                  { label: "delivered", value: c.delivered, dot: "bg-emerald-600" },
                  { label: "read", value: c.read, dot: "bg-[var(--brand)]" },
                  { label: "failed", value: c.failed, dot: "bg-rose-600" },
                  { label: "skipped", value: c.skipped, dot: "bg-muted-foreground/25" },
                ];
                return (
                  <Card key={c.id} className="flex flex-col">
                    <CardHeader className="gap-1.5 pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-sm leading-snug">{c.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {c.segmentName ?? "All active customers"} · via {ctx.tenant.settings.channels[c.channel].label}
                          </CardDescription>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] uppercase">{c.channel}</Badge>
                          <Badge variant={sb.variant} className={`capitalize ${sb.className}`}>{c.status}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3">
                      <div className="line-clamp-2 rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-snug text-muted-foreground">
                        {c.template}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                        {stats.map((s) => (
                          <span key={s.label} className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                            <span className="tabular-nums font-medium text-foreground">{s.value}</span> {s.label}
                          </span>
                        ))}
                      </div>
                      {c.total > 0 ? (
                        <div className="space-y-1">
                          <Progress value={pct} className="h-1.5 bg-muted/60 [&>div]:bg-[var(--brand)]" />
                          <p className="text-[10px] text-muted-foreground">
                            {pct}% delivered ({c.delivered}/{c.total})
                          </p>
                        </div>
                      ) : null}
                      {c.scheduledAt || c.completedAt ? (
                        <p className="text-[10px] text-muted-foreground">
                          {c.scheduledAt ? `scheduled ${formatDateTime(c.scheduledAt)}` : ""}
                          {c.scheduledAt && c.completedAt ? " · " : ""}
                          {c.completedAt ? `completed ${formatDateTime(c.completedAt)}` : ""}
                        </p>
                      ) : null}
                    </CardContent>
                    <CardFooter className="flex-wrap gap-2 pb-4">
                      {c.status === "draft" || c.status === "scheduled" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={busyCampaignId === c.id}
                          onClick={() => void runCampaign(c)}
                        >
                          {busyCampaignId === c.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          Run now
                        </Button>
                      ) : null}
                      {c.status === "draft" || c.status === "scheduled" ? (
                        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openSchedule(c)}>
                          <CalendarClock className="h-3.5 w-3.5" /> Schedule
                        </Button>
                      ) : null}
                      {c.status === "draft" || c.status === "scheduled" || c.status === "running" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 text-rose-600 hover:text-rose-700"
                          disabled={busyCampaignId === c.id}
                          onClick={() => void cancelCampaign(c)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={() => void openMessages(c)}>
                        <ScrollText className="h-3.5 w-3.5" /> Messages
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No campaigns yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Broadcast a promo to everyone or a segment — with AI-assisted copy and scheduling.
              </p>
              <Button size="sm" className="mt-4 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> New campaign
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ---------- TAB 2: offers ---------- */}
        <TabsContent value="offers" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={offersLoading} onClick={() => void loadOffers()}>
              <RefreshCw className={`h-3.5 w-3.5 ${offersLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" className="ml-auto gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={openOfferCreate}>
              <Plus className="h-3.5 w-3.5" /> New offer
            </Button>
          </div>

          {offersLoading && !offers ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="space-y-3 p-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-7 w-44" />
                </Card>
              ))}
            </div>
          ) : offers && offers.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {offers.map((o) => {
                const active = activeCouponsOf(o);
                return (
                  <Card key={o.id} className="flex flex-col">
                    <CardHeader className="gap-1.5 pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-sm leading-snug">{o.title}</CardTitle>
                          {o.description ? (
                            <CardDescription className="mt-0.5 line-clamp-2 text-xs">{o.description}</CardDescription>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">{o.kind.replace(/_/g, " ")}</Badge>
                          <Badge variant="outline" className={`capitalize text-[10px] ${offerStatusClass(o.status)}`}>
                            {o.status}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-2.5">
                      <p className="text-sm font-semibold text-[var(--brand)]">{offerValueLabel(o)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(o.startsAt)} → {o.expiresAt ? formatDate(o.expiresAt) : "no end date"} · via{" "}
                        {ctx.tenant.settings.channels[o.channel].label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.couponCount} coupons · {o.redemptionCount} redemptions
                      </p>
                      {active.length > 0 ? (
                        <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                          active codes: {active.slice(0, 3).map((cp) => cp.code).join(", ")}
                          {active.length > 3 ? " …" : ""}
                        </p>
                      ) : null}
                    </CardContent>
                    <CardFooter className="flex-wrap gap-2 pb-4">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openGenerate(o)}>
                        <Ticket className="h-3.5 w-3.5" /> Generate coupons
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        disabled={o.status !== "active"}
                        onClick={() => openRedeem(o)}
                      >
                        Redeem
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <Gift className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No offers yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a discount, birthday treat or points bonus — attach coupons customers can redeem in store.
              </p>
              <Button size="sm" className="mt-4 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={openOfferCreate}>
                <Plus className="h-3.5 w-3.5" /> New offer
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ---------- TAB 3: coupons ---------- */}
        <TabsContent value="coupons" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {COUPON_FILTERS.map((f) => {
              const active = couponFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCouponFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              disabled={couponsLoading}
              onClick={() => void loadCoupons(couponFilter)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${couponsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {couponsLoading && !coupons ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : coupons && coupons.length > 0 ? (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block max-h-[420px] overflow-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px] uppercase tracking-wide">
                      <TableHead>Code</TableHead>
                      <TableHead>Offer</TableHead>
                      <TableHead>Holder</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Redeemed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coupons.map((cp) => (
                      <TableRow key={cp.id} className="text-xs">
                        <TableCell className="font-mono">{cp.code}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{cp.offer?.title ?? "—"}</TableCell>
                        <TableCell>{cp.customer?.name ?? "unassigned"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize text-[10px] ${couponStatusClass(cp.status)}`}>
                            {cp.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{cp.pointsCost ?? "—"}</TableCell>
                        <TableCell>{formatDate(cp.expiresAt)}</TableCell>
                        <TableCell>{formatDate(cp.redeemedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card Stack */}
              <div className="block md:hidden space-y-2.5">
                {coupons.map((cp) => (
                  <Card key={`m-${cp.id}`} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-bold tracking-wider">{cp.code}</span>
                        <div className="truncate text-xs text-muted-foreground">{cp.offer?.title ?? "General Coupon"}</div>
                      </div>
                      <Badge variant="outline" className={`capitalize text-[10px] ${couponStatusClass(cp.status)}`}>
                        {cp.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                      <span>Holder: <strong className="text-foreground">{cp.customer?.name ?? "unassigned"}</strong></span>
                      <span>Expires: {formatDate(cp.expiresAt)}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card className="p-8 text-center">
              <Ticket className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No coupons match this filter</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate codes from an offer on the Offers tab — they appear here instantly.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ---------- schedule dialog ---------- */}
      <Dialog open={scheduleFor !== null} onOpenChange={(open) => !open && setScheduleFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Schedule — {scheduleFor?.name}</DialogTitle>
            <DialogDescription>
              The campaign.scheduled event is queued — the worker fires the campaign at the chosen time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sched-at">Run at</Label>
            <Input id="sched-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Times are in this browser&apos;s local timezone.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setScheduleFor(null)}>Cancel</Button>
            <Button
              disabled={scheduling}
              onClick={() => void submitSchedule()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {scheduling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Schedule campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- messages dialog ---------- */}
      <Dialog open={msgFor !== null} onOpenChange={(open) => !open && setMsgFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Messages — {msgFor?.name}</DialogTitle>
            <DialogDescription>Every send this campaign produced, with delivery status and retries.</DialogDescription>
          </DialogHeader>
          {msgLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : messages.length > 0 ? (
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {messages.map((m) => (
                <div key={m.id} className="rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-medium">{m.customer?.name ?? "unknown customer"}</span>
                      <Badge variant="outline" className={`capitalize text-[10px] ${messageStatusClass(m.status)}`}>
                        {m.status}
                      </Badge>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(m.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                    {m.subject ? `${m.subject} — ` : ""}
                    {m.body}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/80">
                    <span>
                      {m.channel} · {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                    </span>
                    {m.lastError ? <span className="line-clamp-1 text-rose-600">{m.lastError}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet — run the campaign first.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- new campaign dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">New campaign</DialogTitle>
            <DialogDescription>Broadcast to a segment or all customers — sends go through the outbox with retries.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cam-name">Name</Label>
              <Input
                id="cam-name"
                value={draft.name}
                onChange={(e) => upDraft({ name: e.target.value })}
                placeholder="June monsoon bounce-back"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cam-channel">Channel</Label>
                <Select value={draft.channel} onValueChange={(v) => upDraft({ channel: v as ChannelId })}>
                  <SelectTrigger id="cam-channel" className="text-xs">
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
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cam-segment">Audience</Label>
                <Select value={draft.segmentId} onValueChange={(v) => upDraft({ segmentId: v })}>
                  <SelectTrigger id="cam-segment" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All customers</SelectItem>
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
                <p className="text-xs font-semibold">AI assist</p>
                <span className="text-[10px] text-muted-foreground">drafts the message for you</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={draft.aiGoal}
                  onChange={(e) => upDraft({ aiGoal: e.target.value })}
                  placeholder="Goal — e.g. win back customers inactive for 3 months"
                  className="text-xs"
                />
                <Select value={draft.aiTone} onValueChange={(v) => upDraft({ aiTone: v })}>
                  <SelectTrigger className="text-xs" aria-label="Tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_TONES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={aiBusy} onClick={() => void draftWithAi()}>
                {aiBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft with AI
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-template">Message template</Label>
              <Textarea
                id="cam-template"
                rows={4}
                value={draft.template}
                onChange={(e) => upDraft({ template: e.target.value })}
                placeholder="Hi {name}, we have something special for you at {business}!"
              />
              <p className="text-[10px] text-muted-foreground">{"Variables: {name} {business} {points}"}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-when">Schedule (optional)</Label>
              <Input
                id="cam-when"
                type="datetime-local"
                value={draft.scheduledAt}
                onChange={(e) => upDraft({ scheduledAt: e.target.value })}
              />
              <p className="text-[10px] text-muted-foreground">Leave empty to save as a draft.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={creating}
              onClick={() => void createCampaign()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {creating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Create campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- generate coupons dialog ---------- */}
      <Dialog open={genFor !== null} onOpenChange={(open) => !open && setGenFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Generate coupons — {genFor?.title}</DialogTitle>
            <DialogDescription>Unique codes are created for this offer and expire with it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gen-count">How many codes</Label>
              <Input
                id="gen-count"
                type="number"
                min={1}
                max={200}
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                className="w-32"
              />
            </div>
            {generated.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Generated codes</p>
                <div className="max-h-[420px] overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
                  {generated.map((cp) => (
                    <div key={cp.id} className="px-1 py-0.5">
                      {cp.code}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setGenFor(null)}>Close</Button>
            <Button
              disabled={genBusy}
              onClick={() => void generateCoupons()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {genBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- redeem dialog ---------- */}
      <Dialog open={redeemFor !== null} onOpenChange={(open) => !open && setRedeemFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Redeem — {redeemFor?.title}</DialogTitle>
            <DialogDescription>
              Pick a customer and optionally a coupon code. Redemption is idempotent per customer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="redeem-search">Customer</Label>
              <Input
                id="redeem-search"
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search by name, email or phone"
              />
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {custLoading ? (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : custResults.length > 0 ? (
                  custResults.map((cu) => (
                    <button
                      key={cu.id}
                      type="button"
                      onClick={() => setPickedId(cu.id)}
                      className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
                        pickedId === cu.id ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "hover:bg-accent"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{cu.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{cu.email}</span>
                      </span>
                      {pickedId === cu.id ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  ))
                ) : (
                  <p className="p-4 text-center text-xs text-muted-foreground">No customers match.</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Coupon (optional)</Label>
              <Select value={redeemCode} onValueChange={setRedeemCode}>
                <SelectTrigger className="text-xs" aria-label="Coupon code">
                  <SelectValue placeholder="No coupon — direct redemption" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">No coupon — direct redemption</SelectItem>
                  {(redeemFor?.coupons ?? [])
                    .filter((cp) => cp.status === "active")
                    .map((cp) => (
                      <SelectItem key={cp.id} value={cp.code} className="font-mono text-xs">
                        {cp.code}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRedeemFor(null)}>Cancel</Button>
            <Button
              disabled={!pickedId || redeemBusy}
              onClick={() => void submitRedeem()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {redeemBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Redeem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- new offer dialog ---------- */}
      <Dialog open={offerCreateOpen} onOpenChange={setOfferCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">New offer</DialogTitle>
            <DialogDescription>
              Discounts, birthday treats or points bonuses — the offer.created event is queued to the outbox.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="offer-title">Title</Label>
              <Input
                id="offer-title"
                value={offerDraft.title}
                onChange={(e) => upOfferDraft({ title: e.target.value })}
                placeholder="Monsoon mani-pedi at 15% off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="offer-desc">Description</Label>
              <Textarea
                id="offer-desc"
                rows={2}
                value={offerDraft.description}
                onChange={(e) => upOfferDraft({ description: e.target.value })}
                placeholder="Shown to customers on the portal and in messages"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="offer-kind">Kind</Label>
                <Select value={offerDraft.kind} onValueChange={(v) => upOfferDraft({ kind: v as OfferKind })}>
                  <SelectTrigger id="offer-kind" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFER_KINDS.map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {k.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="offer-value">Value</Label>
                <Input
                  id="offer-value"
                  type="number"
                  min={0}
                  value={offerDraft.value}
                  onChange={(e) => upOfferDraft({ value: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">
                  {offerDraft.kind === "discount"
                    ? "Percent off the bill."
                    : offerDraft.kind === "points_bonus"
                      ? "Bonus loyalty points granted on redemption."
                      : offerDraft.kind === "birthday_greeting"
                        ? "A treat — no numeric value needed."
                        : "Free-form value."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="offer-channel">Channel</Label>
                <Select value={offerDraft.channel} onValueChange={(v) => upOfferDraft({ channel: v as ChannelId })}>
                  <SelectTrigger id="offer-channel" className="text-xs">
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
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="offer-exp">Expires (optional)</Label>
                <Input
                  id="offer-exp"
                  type="date"
                  value={offerDraft.expiresAt}
                  onChange={(e) => upOfferDraft({ expiresAt: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">Expiry nudges fire 3 days before.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="offer-gen">Generate coupons (optional)</Label>
              <Input
                id="offer-gen"
                type="number"
                min={0}
                max={200}
                value={offerDraft.generateCoupons}
                onChange={(e) => upOfferDraft({ generateCoupons: e.target.value })}
                className="w-32"
              />
              <p className="text-[10px] text-muted-foreground">Codes are created immediately after saving.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOfferCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={offerBusy}
              onClick={() => void createOffer()}
              className="bg-[var(--brand)] text-white hover:opacity-90"
            >
              {offerBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Create offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
