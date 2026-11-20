"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Coins, Download, Ticket, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost, downloadFile } from "@/lib/client/api";
import { formatDate, formatDateTime, formatINR, initials, timeAgo } from "@/lib/client/format";
import type { AppCtx, LoyaltyRules } from "@/lib/client/types";

// ---------------------------------------------------------------------------
// Local DTOs (mirrors of GET /api/loyalty)
// ---------------------------------------------------------------------------

type LoyaltyAccount = {
  id: string;
  name: string;
  email: string;
  pointsBalance: number;
  visitCount: number;
  totalSpendCents: number;
};

type LoyaltyTransaction = {
  id: string;
  kind: string; // earn_visit | earn_feedback | earn_referral | earn_offer | redeem | adjust | expire | bonus
  points: number;
  reason: string;
  balanceAfter: number;
  idempotencyKey: string;
  createdAt: string;
  customer: { id: string; name: string };
};

type LoyaltyReferral = {
  code: string;
  usesCount: number;
  customer: { id: string; name: string };
};

type LoyaltyCoupon = {
  id: string;
  code: string;
  status: string; // active | redeemed | expired
  pointsCost: number | null;
  expiresAt: string | null;
  offer: { title: string } | null;
  customer: { name: string } | null;
};

type LoyaltyPayload = {
  accounts: LoyaltyAccount[];
  transactions: LoyaltyTransaction[];
  referrals: LoyaltyReferral[];
  coupons: LoyaltyCoupon[];
  rules: LoyaltyRules;
  enabled: boolean;
};

type RuleKey =
  | "pointsPerVisit"
  | "pointsPerFeedback"
  | "pointsPerReferral"
  | "pointsPerHundredRupees"
  | "referralBonus"
  | "redemptionMinimum";

type RulesDraft = { enabled: boolean } & Record<RuleKey, string>;

const RULE_FIELDS: { key: RuleKey; label: string; hint: string }[] = [
  { key: "pointsPerVisit", label: "Points per visit", hint: "Credited when a completed visit is logged." },
  { key: "pointsPerFeedback", label: "Points per feedback", hint: "Credited once per feedback response." },
  { key: "pointsPerReferral", label: "Points per referral", hint: "Credited to the referrer when their code is used." },
  { key: "pointsPerHundredRupees", label: "Points per ₹100 spent", hint: "Spend-linked earning on every logged visit." },
  { key: "referralBonus", label: "Referral welcome bonus", hint: "Welcome points for the newly referred customer." },
  { key: "redemptionMinimum", label: "Redemption minimum", hint: "Fewest points a single redemption can spend." },
];

const EARN_KINDS: Record<string, string> = {
  earn_visit: "Visit",
  earn_feedback: "Feedback",
  earn_referral: "Referral",
  earn_offer: "Offer",
  bonus: "Bonus",
};

/** Immutable update of a single numeric rule field (exhaustive, type-safe). */
function withRule(draft: RulesDraft, key: RuleKey, value: string): RulesDraft {
  switch (key) {
    case "pointsPerVisit":
      return { ...draft, pointsPerVisit: value };
    case "pointsPerFeedback":
      return { ...draft, pointsPerFeedback: value };
    case "pointsPerReferral":
      return { ...draft, pointsPerReferral: value };
    case "pointsPerHundredRupees":
      return { ...draft, pointsPerHundredRupees: value };
    case "referralBonus":
      return { ...draft, referralBonus: value };
    case "redemptionMinimum":
      return { ...draft, redemptionMinimum: value };
  }
}

function kindLabel(kind: string): string {
  return EARN_KINDS[kind] ?? kind.replace(/_/g, " ");
}

function kindBadge(kind: string): { variant: "secondary" | "outline"; className: string } {
  if (EARN_KINDS[kind]) return { variant: "outline", className: "border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700" };
  if (kind === "redeem") return { variant: "outline", className: "border-rose-600 bg-rose-600/10 text-[10px] text-rose-700" };
  if (kind === "adjust") return { variant: "outline", className: "border-amber-600 bg-amber-600/10 text-[10px] text-amber-700" };
  return { variant: "secondary", className: "text-[10px]" };
}

function couponBadge(status: string): { variant: "secondary" | "outline"; className: string } {
  if (status === "active") return { variant: "outline", className: "border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700" };
  if (status === "expired") return { variant: "outline", className: "border-rose-600 bg-rose-600/10 text-[10px] text-rose-700" };
  return { variant: "secondary", className: "text-[10px] text-muted-foreground" };
}

function KpiCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--brand)]/10">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main view — Members | Transactions | Referrals | Rules
// ---------------------------------------------------------------------------

export default function LoyaltyView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();

  const [data, setData] = useState<LoyaltyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<RulesDraft | null>(null);
  const [savingRules, setSavingRules] = useState(false);

  // Adjust dialog
  const [adjustTarget, setAdjustTarget] = useState<LoyaltyAccount | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  // Redeem dialog
  const [redeemTarget, setRedeemTarget] = useState<LoyaltyAccount | null>(null);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet<LoyaltyPayload>("/api/loyalty");
      setData(payload);
      setLoadError(null);
      setRulesDraft({
        pointsPerVisit: String(payload.rules.pointsPerVisit ?? 0),
        pointsPerFeedback: String(payload.rules.pointsPerFeedback ?? 0),
        pointsPerReferral: String(payload.rules.pointsPerReferral ?? 0),
        pointsPerHundredRupees: String(payload.rules.pointsPerHundredRupees ?? 0),
        referralBonus: String(payload.rules.referralBonus ?? 0),
        redemptionMinimum: String(payload.rules.redemptionMinimum ?? 0),
        enabled: payload.enabled,
      });
    } catch (err) {
      setLoadError((err as Error).message);
      toast({ title: "Could not load loyalty data", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = data?.accounts ?? [];
  const transactions = data?.transactions ?? [];
  const referrals = data?.referrals ?? [];
  const coupons = data?.coupons ?? [];
  const rules = data?.rules ?? ctx.tenant.settings.loyalty;
  const avgBalance = useMemo(
    () => (accounts.length ? Math.round(accounts.reduce((sum, a) => sum + a.pointsBalance, 0) / accounts.length) : 0),
    [accounts]
  );

  const openAdjust = (a: LoyaltyAccount) => {
    setAdjustTarget(a);
    setAdjustPoints("");
    setAdjustReason("");
  };

  const submitAdjust = async () => {
    if (!adjustTarget) return;
    const pts = Number(adjustPoints);
    if (!Number.isFinite(pts) || pts === 0) {
      toast({ title: "Enter a non-zero point amount", variant: "destructive" });
      return;
    }
    setDialogBusy(true);
    try {
      await apiPost("/api/loyalty", {
        action: "adjust",
        customerId: adjustTarget.id,
        points: pts,
        reason: adjustReason.trim() || undefined,
      });
      toast({ title: "Balance adjusted", description: `${pts > 0 ? "+" : ""}${pts} pts · ${adjustTarget.name}` });
      setAdjustTarget(null);
      await load();
    } catch (err) {
      toast({ title: "Adjustment failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDialogBusy(false);
    }
  };

  const submitRedeem = async () => {
    if (!redeemTarget) return;
    const pts = Number(redeemPoints);
    if (!Number.isFinite(pts) || pts <= 0) {
      toast({ title: "Enter points to redeem", variant: "destructive" });
      return;
    }
    setDialogBusy(true);
    try {
      const res = await apiPost<{ couponCode: string; balanceAfter: number; message: string }>("/api/loyalty", {
        action: "redeem",
        customerId: redeemTarget.id,
        points: pts,
      });
      toast({ title: "Points redeemed", description: res.message });
      setRedeemTarget(null);
      await load();
    } catch (err) {
      toast({ title: "Redemption failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDialogBusy(false);
    }
  };

  const saveRules = async () => {
    if (!rulesDraft) return;
    setSavingRules(true);
    try {
      await apiPatch("/api/tenant", {
        section: "loyaltyRules",
        patch: {
          pointsPerVisit: Number(rulesDraft.pointsPerVisit) || 0,
          pointsPerFeedback: Number(rulesDraft.pointsPerFeedback) || 0,
          pointsPerReferral: Number(rulesDraft.pointsPerReferral) || 0,
          pointsPerHundredRupees: Number(rulesDraft.pointsPerHundredRupees) || 0,
          referralBonus: Number(rulesDraft.referralBonus) || 0,
          redemptionMinimum: Number(rulesDraft.redemptionMinimum) || 0,
          enabled: rulesDraft.enabled,
        },
      });
      toast({ title: "Loyalty rules saved", description: "Applied to future events immediately." });
      await load();
    } catch (err) {
      toast({ title: "Could not save rules", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingRules(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Loyalty is unavailable</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span className="flex-1">{loadError ?? "Could not load loyalty data."}</span>
          <Button size="sm" variant="outline" className="h-9" onClick={() => void load()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Loyalty &amp; Rewards</h1>
        <Badge variant="outline" className="border-[var(--brand)] text-xs text-[var(--brand)]">
          {rules.pointsPerVisit} pts / visit · {rules.pointsPerFeedback} pts / feedback · {rules.pointsPerReferral} pts / referral
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-10 gap-1.5"
            onClick={() => downloadFile("/api/export/loyalty", `loyalty-${ctx.tenant.slug}.csv`)}
          >
            <Download className="h-4 w-4" /> Export ledger
          </Button>
        </div>
      </div>

      <Tabs defaultValue="members" className="gap-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="members" className="flex-1">Members</TabsTrigger>
          <TabsTrigger value="transactions" className="flex-1">Transactions</TabsTrigger>
          <TabsTrigger value="referrals" className="flex-1">Referrals</TabsTrigger>
          <TabsTrigger value="rules" className="flex-1">Rules</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------- Members */}
        <TabsContent value="members" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard icon={<Users className="h-5 w-5 text-[var(--brand)]" />} label="Active members" value={String(accounts.length)} />
            <KpiCard icon={<Coins className="h-5 w-5 text-[var(--brand)]" />} label="Average balance" value={`${avgBalance} pts`} />
            <KpiCard icon={<Ticket className="h-5 w-5 text-[var(--brand)]" />} label="Coupons issued" value={String(coupons.length)} />
          </div>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Members</CardTitle>
              <CardDescription>Top point-holders — balances update as visit and feedback events land.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop Members Table */}
              <div className="hidden md:block max-h-[420px] overflow-y-auto">
                {accounts.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Lifetime value</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 shrink-0">
                                <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">
                                  {initials(a.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{a.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{a.pointsBalance}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.visitCount}</TableCell>
                          <TableCell className="hidden text-right font-medium tabular-nums sm:table-cell">
                            {formatINR(a.totalSpendCents)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" className="h-9" onClick={() => openAdjust(a)}>
                                Adjust
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9"
                                onClick={() => {
                                  setRedeemTarget(a);
                                  setRedeemPoints("");
                                }}
                              >
                                Redeem
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No loyalty members yet — members appear once customers start earning points.
                  </p>
                )}
              </div>

              {/* Mobile Members Card Stack */}
              <div className="block md:hidden p-3 space-y-2.5 max-h-[420px] overflow-y-auto">
                {accounts.length ? (
                  accounts.map((a) => (
                    <Card key={`m-${a.id}`} className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">
                              {initials(a.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{a.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                          </div>
                        </div>
                        <Badge variant="secondary" className="font-semibold text-xs shrink-0">
                          {a.pointsBalance} pts
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                        <span>{a.visitCount} visits</span>
                        <span className="font-medium text-foreground">{formatINR(a.totalSpendCents)} spent</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button variant="outline" size="sm" className="h-10 text-xs" onClick={() => openAdjust(a)}>
                          Adjust Points
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 text-xs"
                          onClick={() => {
                            setRedeemTarget(a);
                            setRedeemPoints("");
                          }}
                        >
                          Redeem
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No loyalty members yet — members appear once customers start earning points.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Recent coupons</CardTitle>
              <CardDescription>Vouchers issued when members redeem points — valid for 90 days.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop Coupons Table */}
              <div className="hidden md:block max-h-[280px] overflow-y-auto">
                {coupons.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Offer</TableHead>
                        <TableHead className="hidden sm:table-cell">Customer</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coupons.map((c) => {
                        const badge = couponBadge(c.status);
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs font-medium">{c.code}</TableCell>
                            <TableCell className="max-w-[180px] truncate text-sm">{c.offer?.title ?? "Points voucher"}</TableCell>
                            <TableCell className="hidden max-w-[140px] truncate text-sm sm:table-cell">{c.customer?.name ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.pointsCost === null ? "—" : `−${c.pointsCost} pts`}
                            </TableCell>
                            <TableCell>
                              <Badge variant={badge.variant} className={badge.className}>
                                {c.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden text-right text-xs text-muted-foreground md:table-cell">
                              {formatDate(c.expiresAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No coupons yet — run a redemption from a member row above.
                  </p>
                )}
              </div>

              {/* Mobile Coupons Card Stack */}
              <div className="block md:hidden p-3 space-y-2.5 max-h-[280px] overflow-y-auto">
                {coupons.length ? (
                  coupons.map((c) => {
                    const badge = couponBadge(c.status);
                    return (
                      <Card key={`m-cp-${c.id}`} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold">{c.code}</span>
                          <Badge variant={badge.variant} className={badge.className}>
                            {c.status}
                          </Badge>
                        </div>
                        <p className="text-xs font-medium truncate">{c.offer?.title ?? "Points voucher"}</p>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
                          <span>{c.customer?.name ?? "Unassigned"}</span>
                          <span>{c.pointsCost === null ? "Free" : `−${c.pointsCost} pts`}</span>
                        </div>
                      </Card>
                    );
                  })
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No coupons yet — run a redemption from a member row above.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- Transactions */}
        <TabsContent value="transactions" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Every credit is guarded by a unique idempotency key — duplicates are impossible by construction.
          </p>
          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Ledger — last {transactions.length} transactions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop Transactions Table */}
              <div className="hidden md:block max-h-[420px] overflow-y-auto">
                {transactions.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Points</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="hidden md:table-cell">Reason</TableHead>
                        <TableHead className="hidden lg:table-cell">Key</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((t) => {
                        const badge = kindBadge(t.kind);
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="whitespace-nowrap">
                              <div className="text-sm">{formatDateTime(t.createdAt)}</div>
                              <div className="text-[10px] text-muted-foreground">{timeAgo(t.createdAt)}</div>
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate text-sm">{t.customer.name}</TableCell>
                            <TableCell>
                              <Badge variant={badge.variant} className={badge.className}>
                                {kindLabel(t.kind)}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className={`text-right font-semibold tabular-nums ${t.points >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                            >
                              {t.points >= 0 ? `+${t.points}` : `${t.points}`}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{t.balanceAfter}</TableCell>
                            <TableCell className="hidden max-w-[200px] truncate text-xs text-muted-foreground md:table-cell">
                              {t.reason}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block max-w-[110px] cursor-default truncate font-mono text-[10px] text-muted-foreground">
                                    {t.idempotencyKey}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[260px] break-all font-mono text-[10px]">
                                  {t.idempotencyKey}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">No loyalty activity yet.</p>
                )}
              </div>

              {/* Mobile Transactions Card Stack */}
              <div className="block md:hidden p-3 space-y-2.5 max-h-[420px] overflow-y-auto">
                {transactions.length ? (
                  transactions.map((t) => {
                    const badge = kindBadge(t.kind);
                    return (
                      <Card key={`m-tx-${t.id}`} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">{t.customer.name}</span>
                          <span
                            className={`font-semibold text-xs tabular-nums ${t.points >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
                          >
                            {t.points >= 0 ? `+${t.points}` : `${t.points}`} pts
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={badge.variant} className={badge.className}>
                            {kindLabel(t.kind)}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">Balance: {t.balanceAfter}</span>
                        </div>
                        {t.reason && <p className="text-[11px] text-muted-foreground truncate">{t.reason}</p>}
                        <div className="text-[10px] text-muted-foreground pt-1 border-t">
                          {formatDateTime(t.createdAt)} ({timeAgo(t.createdAt)})
                        </div>
                      </Card>
                    );
                  })
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">No loyalty activity yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ Referrals */}
        <TabsContent value="referrals" className="space-y-4">
          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Referral codes</CardTitle>
              <CardDescription>Personal codes issued at registration, ranked by uses.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop Referrals Table */}
              <div className="hidden md:block max-h-[420px] overflow-y-auto">
                {referrals.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Referrer</TableHead>
                        <TableHead className="text-right">Uses</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {referrals.map((r) => (
                        <TableRow key={r.code}>
                          <TableCell className="font-mono text-xs font-medium">{r.code}</TableCell>
                          <TableCell className="max-w-[220px] truncate text-sm">{r.customer.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.usesCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No referral codes yet — codes are issued as customers register.
                  </p>
                )}
              </div>

              {/* Mobile Referrals Card Stack */}
              <div className="block md:hidden p-3 space-y-2 max-h-[420px] overflow-y-auto">
                {referrals.length ? (
                  referrals.map((r) => (
                    <Card key={`m-ref-${r.code}`} className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold">{r.code}</span>
                        <p className="text-xs text-muted-foreground truncate">{r.customer.name}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0 font-semibold">
                        {r.usesCount} uses
                      </Badge>
                    </Card>
                  ))
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No referral codes yet — codes are issued as customers register.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="py-4">
            <CardContent className="px-4 sm:px-6">
              <p className="text-sm font-medium">How referrals work</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Each customer gets a personal code at registration; new registrations citing it credit{" "}
                {rules.pointsPerReferral} pts to the referrer and a {rules.referralBonus} pts welcome bonus to the
                newcomer — exactly once each.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------------------- Rules */}
        <TabsContent value="rules" className="space-y-4">
          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Earning &amp; redemption rules</CardTitle>
              <CardDescription>Tune how points are earned and spent across the workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 px-4 py-4 sm:px-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {RULE_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
                    <Input
                      id={`rule-${f.key}`}
                      type="number"
                      min={0}
                      className="h-10"
                      value={rulesDraft?.[f.key] ?? ""}
                      onChange={(e) => setRulesDraft((r) => (r ? withRule(r, f.key, e.target.value) : r))}
                    />
                    <p className="text-xs text-muted-foreground">{f.hint}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Module active</p>
                  <p className="text-xs text-muted-foreground">Pause earning without touching existing balances.</p>
                </div>
                <Switch
                  checked={rulesDraft?.enabled ?? false}
                  onCheckedChange={(v) => setRulesDraft((r) => (r ? { ...r, enabled: v } : r))}
                  aria-label="Loyalty module active"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between border-t px-4 py-4 sm:px-6">
              <p className="text-xs text-muted-foreground">Applied to future events immediately.</p>
              <Button
                className="h-10 bg-[var(--brand)] text-white hover:opacity-90"
                disabled={savingRules || !rulesDraft}
                onClick={() => void saveRules()}
              >
                {savingRules ? "Saving…" : "Save rules"}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Adjust dialog */}
      <Dialog open={!!adjustTarget} onOpenChange={(o) => !o && setAdjustTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust balance — {adjustTarget?.name}</DialogTitle>
            <DialogDescription>Manual correction for support cases; negative values claw points back.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adjust-points">Points (positive or negative)</Label>
              <Input
                id="adjust-points"
                type="number"
                className="h-10"
                placeholder="e.g. 50 or -25"
                value={adjustPoints}
                onChange={(e) => setAdjustPoints(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-reason">Reason</Label>
              <Input
                id="adjust-reason"
                className="h-10"
                placeholder="Goodwill — service delay"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Current balance: <span className="font-semibold tabular-nums">{adjustTarget?.pointsBalance ?? 0} pts</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-10" onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button
              className="h-10 bg-[var(--brand)] text-white hover:opacity-90"
              disabled={dialogBusy}
              onClick={() => void submitAdjust()}
            >
              {dialogBusy ? "Applying…" : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redeem dialog */}
      <Dialog open={!!redeemTarget} onOpenChange={(o) => !o && setRedeemTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redeem points — {redeemTarget?.name}</DialogTitle>
            <DialogDescription>Points convert into a voucher coupon the customer can use on their next visit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="redeem-points">Points to redeem</Label>
              <Input
                id="redeem-points"
                type="number"
                min={1}
                className="h-10"
                placeholder={`at least ${rules.redemptionMinimum}`}
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Minimum redemption is {rules.redemptionMinimum} pts · current balance {redeemTarget?.pointsBalance ?? 0} pts.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-10" onClick={() => setRedeemTarget(null)}>
              Cancel
            </Button>
            <Button
              className="h-10 bg-[var(--brand)] text-white hover:opacity-90"
              disabled={dialogBusy}
              onClick={() => void submitRedeem()}
            >
              {dialogBusy ? "Redeeming…" : "Redeem points"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
