"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard, Users, Star, Workflow, Megaphone, Gift, CalendarClock,
  Palette, BarChart3, ShieldCheck, Globe, ClipboardList, Sun, Moon,
  LogOut, RefreshCw, ChevronsUpDown, HeartPulse, Menu, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/client/api";
import type { AppCtx, AppUser, TenantInfo, TenantSummary, UsageSnapshot, EventCatalogEntry } from "@/lib/client/types";
import { LoginScreen } from "@/components/app/login-screen";
import { DashboardView } from "@/components/app/dashboard-view";

export type ViewId =
  | "dashboard" | "customers" | "feedback" | "automation" | "campaigns"
  | "loyalty" | "appointments" | "whitelabel" | "analytics" | "ops" | "portal" | "report";

type BootResponse = {
  user: AppUser | null;
  tenant?: TenantInfo;
  tenants: TenantSummary[];
  usage?: UsageSnapshot | null;
  eventCatalog?: EventCatalogEntry[];
};

type Heartbeat = { pending: number; dead: number; lastTickAt: number | null };

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex flex-col bg-background">
        <div className="flex-1 grid place-items-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <HeartPulse className="h-5 w-5 animate-pulse text-[var(--brand,#0f766e)]" />
            <span className="text-sm">Booting GS ClientFlow…</span>
          </div>
        </div>
      </div>
    }>
      <ClientFlowApp />
    </Suspense>
  );
}

function ClientFlowApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view") as ViewId | null;

  const [ctx, setCtx] = useState<AppCtx | null>(null);
  const [tenantsPublic, setTenantsPublic] = useState<TenantSummary[]>([]);
  const [eventCatalog, setEventCatalog] = useState<EventCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setViewState] = useState<ViewId>(viewParam ?? "dashboard");
  const [dark, setDark] = useState(false);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const { toast } = useToast();

  // Sync view state with URL parameters
  const setView = useCallback((nextView: ViewId) => {
    setViewState(nextView);
    const params = new URLSearchParams(window.location.search);
    if (nextView === "dashboard") {
      params.delete("view");
    } else {
      params.set("view", nextView);
    }
    const query = params.toString();
    const url = query ? `?${query}` : window.location.pathname;
    window.history.pushState(null, "", url);
  }, []);

  // Sync on browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const currentParams = new URLSearchParams(window.location.search);
      const v = (currentParams.get("view") as ViewId) ?? "dashboard";
      setViewState(v);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const data = await apiGet<BootResponse>("/api/auth/me");
      setTenantsPublic(data.tenants ?? []);
      setEventCatalog(data.eventCatalog ?? []);
      if (data.user && data.tenant) {
        setCtx({
          user: data.user,
          tenant: data.tenant,
          tenants: data.tenants ?? [],
          usage: data.usage ?? null,
          eventCatalog: data.eventCatalog ?? [],
        });
      } else {
        setCtx(null);
      }
    } catch {
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Listen for brand updates dispatched by WhiteLabelView and merge them into ctx immediately
  useEffect(() => {
    const handler = (e: Event) => {
      const patch = (e as CustomEvent<Partial<TenantInfo>>).detail;
      setCtx((prev) =>
        prev ? { ...prev, tenant: { ...prev.tenant, ...patch } } : null
      );
    };
    window.addEventListener("gscf:brand-updated", handler);
    return () => window.removeEventListener("gscf:brand-updated", handler);
  }, []);

  // Footer worker heartbeat
  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    const poll = async () => {
      try {
        const ops = await apiGet<{ queue: { global: { status: string; count: number }[] } }>("/api/ops");
        if (!alive) return;
        setHeartbeat({
          pending: ops.queue.global.find((q) => q.status === "pending")?.count ?? 0,
          dead: ops.queue.global.find((q) => q.status === "dead")?.count ?? 0,
          lastTickAt: null,
        });
      } catch {
        /* footer must never spam errors */
      }
    };
    void poll();
    const timer = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ctx?.tenant.id]);

  const activeNav = useMemo(() => {
    if (!ctx) return [];
    const modules = ctx.tenant.settings.modules;
    const nav: { id: ViewId; label: string; icon: React.ElementType; enabled: boolean; group: string }[] = [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true, group: "Operate" },
      { id: "customers", label: "Customers", icon: Users, enabled: true, group: "Operate" },
      { id: "feedback", label: "Feedback", icon: Star, enabled: modules.feedback, group: "Operate" },
      { id: "automation", label: "Automation", icon: Workflow, enabled: true, group: "Grow" },
      { id: "campaigns", label: "Campaigns & Offers", icon: Megaphone, enabled: modules.campaigns, group: "Grow" },
      { id: "loyalty", label: "Loyalty", icon: Gift, enabled: modules.loyalty, group: "Grow" },
      { id: "appointments", label: "Appointments", icon: CalendarClock, enabled: modules.appointments, group: "Grow" },
      { id: "whitelabel", label: "White-label", icon: Palette, enabled: modules.whiteLabel, group: "Platform" },
      { id: "analytics", label: "Analytics", icon: BarChart3, enabled: true, group: "Platform" },
      { id: "ops", label: "Ops & Security", icon: ShieldCheck, enabled: true, group: "Platform" },
      { id: "portal", label: "Client Portal", icon: Globe, enabled: true, group: "Platform" },
      { id: "report", label: "Report", icon: ClipboardList, enabled: true, group: "Platform" },
    ];
    return nav.filter((n) => n.enabled);
  }, [ctx]);

  const groups = useMemo(() => [...new Set(activeNav.map((n) => n.group))], [activeNav]);

  const logout = async () => {
    // Notify service worker to purge tenant caches
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_TENANT_CACHE" });
    }
    await apiPost("/api/auth/logout").catch(() => undefined);
    setCtx(null);
    setView("dashboard");
    await bootstrap();
  };

  const switchTenant = async (tenantId: string) => {
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_TENANT_CACHE" });
      }
      await apiPost("/api/auth/switch-tenant", { tenantId });
      setView("dashboard");
      await bootstrap();
      toast({ title: "Tenant context switched", description: "The session now operates inside the other business — cross-tenant data is invisible." });
    } catch (err) {
      toast({ title: "Could not switch tenant", description: (err as Error).message, variant: "destructive" });
    }
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col bg-background">
        <div className="flex-1 grid place-items-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <HeartPulse className="h-5 w-5 animate-pulse text-[var(--brand,#0f766e)]" />
            <span className="text-sm">Booting GS ClientFlow…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <LoginScreen
        tenants={tenantsPublic}
        eventCatalog={eventCatalog}
        onLoggedIn={bootstrap}
      />
    );
  }

  const t = ctx.tenant;
  const current = activeNav.find((n) => n.id === view) ?? activeNav[0];

  const viewEl = (() => {
    switch (current.id) {
      case "dashboard":
        return <DashboardView ctx={ctx} />;
      case "customers":
        return <LazyView importer={() => import("@/components/app/customers-view")} ctx={ctx} />;
      case "feedback":
        return <LazyView importer={() => import("@/components/app/feedback-view")} ctx={ctx} />;
      case "automation":
        return <LazyView importer={() => import("@/components/app/automation-view")} ctx={ctx} />;
      case "campaigns":
        return <LazyView importer={() => import("@/components/app/campaigns-view")} ctx={ctx} />;
      case "loyalty":
        return <LazyView importer={() => import("@/components/app/loyalty-view")} ctx={ctx} />;
      case "appointments":
        return <LazyView importer={() => import("@/components/app/appointments-view")} ctx={ctx} />;
      case "whitelabel":
        return <LazyView importer={() => import("@/components/app/whitelabel-view")} ctx={ctx} />;
      case "analytics":
        return <LazyView importer={() => import("@/components/app/analytics-view")} ctx={ctx} />;
      case "ops":
        return <LazyView importer={() => import("@/components/app/ops-view")} ctx={ctx} />;
      case "portal":
        return <LazyView importer={() => import("@/components/app/portal-view")} ctx={ctx} />;
      case "report":
        return <LazyView importer={() => import("@/components/app/report-view")} ctx={ctx} />;
      default:
        return <DashboardView ctx={ctx} />;
    }
  })();

  const primaryMobileNav: ViewId[] = ["dashboard", "appointments", "customers", "automation"];

  return (
    <div
      className="min-h-dvh flex flex-col bg-background text-foreground overflow-x-clip"
      style={{ ["--brand" as string]: (!t.brandColor || t.brandColor === "#000000" || t.brandColor === "#000") ? "#0f766e" : t.brandColor }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg grid place-items-center text-[13px] font-bold text-white bg-[var(--brand)] shrink-0">
              {t.logoText || "GC"}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold truncate">{t.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {t.slug}.gsclientflow.app · {t.plan} plan
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {ctx.user.isPlatformAdmin && ctx.tenants.length > 1 && (
              <Select onValueChange={switchTenant} value={t.id}>
                <SelectTrigger className="h-8 w-[190px] text-xs gap-1.5 hidden sm:flex">
                  <SelectValue placeholder="Switch tenant" />
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </SelectTrigger>
                <SelectContent>
                  {ctx.tenants.map((tt) => (
                    <SelectItem key={tt.id} value={tt.id}>
                      {tt.logoText} · {tt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 min-h-9 min-w-9" onClick={toggleDark} aria-label="Toggle theme">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2">
                  <span className="hidden sm:inline text-xs">{ctx.user.name}</span>
                  <span className="sm:hidden text-xs">{ctx.user.name.split(" ")[0]}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {ctx.user.email}
                  <div className="mt-1">
                    <Badge variant="secondary" className="text-[10px]">{ctx.user.role}</Badge>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={bootstrap} className="text-xs gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh session
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={logout} className="text-xs gap-2 text-destructive">
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Scrollable top nav on tablet viewports */}
        <nav className="hidden sm:block lg:hidden border-t overflow-x-auto">
          <div className="flex gap-1 px-3 py-2 w-max">
            {activeNav.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  current.id === n.id ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <n.icon className="h-3.5 w-3.5" />
                {n.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Body */}
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 flex flex-1 gap-6 py-6 pb-24 md:pb-8">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="lg:sticky lg:top-20 space-y-5">
            {groups.map((group) => (
              <div key={group}>
                <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group}</div>
                <div className="space-y-0.5">
                  {activeNav.filter((n) => n.group === group).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setView(n.id)}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        current.id === n.id
                          ? "bg-[var(--brand)] text-white shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <n.icon className="h-4 w-4" />
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0">{viewEl}</main>
      </div>

      {/* Mobile Bottom Navigation Bar (md:hidden) with Safe-Area padding */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 pb-[env(safe-area-inset-bottom)] shadow-lg">
        <div className="grid grid-cols-5 h-14">
          {primaryMobileNav.map((id) => {
            const item = activeNav.find((n) => n.id === id);
            if (!item) return null;
            const Icon = item.icon;
            const isActive = current.id === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex flex-col items-center justify-center gap-1 transition-colors min-h-[44px] ${
                  isActive ? "text-[var(--brand)] font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? "scale-110" : ""}`} />
                <span className="text-[10px] tracking-tight truncate max-w-[64px]">{item.label}</span>
              </button>
            );
          })}

          {/* More trigger opens bottom slide-over sheet */}
          <Sheet open={moreSheetOpen} onOpenChange={setMoreSheetOpen}>
            <SheetTrigger asChild>
              <button
                className={`flex flex-col items-center justify-center gap-1 transition-colors min-h-[44px] ${
                  !primaryMobileNav.includes(current.id) ? "text-[var(--brand)] font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="text-[10px] tracking-tight">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[75dvh] overflow-y-auto px-4 pb-8">
              <SheetHeader className="pb-2">
                <SheetTitle className="text-sm">All Modules &amp; Tools</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-2 pt-2">
                {activeNav.map((n) => {
                  const Icon = n.icon;
                  const isActive = current.id === n.id;
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        setView(n.id);
                        setMoreSheetOpen(false);
                      }}
                      className={`flex items-center gap-2.5 rounded-lg border p-3 text-xs font-medium text-left transition-colors min-h-[44px] ${
                        isActive
                          ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                          : "border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{n.label}</div>
                        <div className="truncate text-[10px] text-muted-foreground">{n.group}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t bg-muted/40 hidden md:block">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium">GS ClientFlow</span>
          <span>multi-tenant client relationship OS</span>
          <span className="hidden sm:inline">·</span>
          <span>{t.name} ({t.slug})</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Production Multi-Tenant Engine</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${heartbeat && heartbeat.dead > 0 ? "bg-destructive" : "bg-emerald-500"}`} />
            worker {heartbeat ? `${heartbeat.pending} queued · ${heartbeat.dead} dead` : "…"}
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Loads a view module lazily with skeleton placeholder so initial payload remains minimal */
function LazyView({ importer, ctx }: { importer: () => Promise<{ default: React.ComponentType<{ ctx: AppCtx }> }>; ctx: AppCtx }) {
  const [Comp, setComp] = useState<React.ComponentType<{ ctx: AppCtx }> | null>(null);
  useEffect(() => {
    let alive = true;
    importer().then((m) => {
      if (alive) setComp(() => m.default);
    });
    return () => {
      alive = false;
    };
  }, [importer]);
  if (!Comp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Loading module…</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </CardContent>
      </Card>
    );
  }
  return <Comp ctx={ctx} />;
}
