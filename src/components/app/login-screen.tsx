"use client";

import { useState } from "react";
import { HeartPulse, LogIn, ShieldCheck, Workflow, Database, Palette, PlusCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiPost } from "@/lib/client/api";
import type { TenantSummary, EventCatalogEntry } from "@/lib/client/types";

const DEMO_EMAILS: Record<string, string> = {
  "aurora-spa": "priya@auroraspa.example",
  "bright-dental": "dr.mehta@brightdental.example",
  "apex-coaching": "director@apexcoaching.example",
  "ironcore-gym": "owner@ironcoregym.example",
};

export function LoginScreen({
  tenants,
  eventCatalog,
  onLoggedIn,
}: {
  tenants: TenantSummary[];
  eventCatalog: EventCatalogEntry[];
  onLoggedIn: () => Promise<void>;
}) {
  const [slug, setSlug] = useState(tenants[0]?.slug ?? "aurora-spa");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  // New business form states
  const [newBizName, setNewBizName] = useState("");
  const [newBizSlug, setNewBizSlug] = useState("");
  const [newBizCategory, setNewBizCategory] = useState("salon_spa");
  const [newBizOwnerName, setNewBizOwnerName] = useState("");
  const [newBizOwnerEmail, setNewBizOwnerEmail] = useState("");
  const [newBizColor, setNewBizColor] = useState("#0f766e");

  const { toast } = useToast();

  const handleLogin = async () => {
    const chosen = email.trim().toLowerCase() || (DEMO_EMAILS[slug] ?? "");
    if (!chosen) {
      toast({
        title: "Enter a staff email",
        description: "Demo emails are listed next to the business selector.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/api/auth/login?tenant=${slug}`, { email: chosen });
      await onLoggedIn();
      toast({
        title: "Signed in",
        description: `Session bound to ${slug} — every query is tenant-scoped from here on.`,
      });
    } catch (err) {
      toast({ title: "Sign-in failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterBusiness = async () => {
    if (!newBizName.trim()) {
      toast({ title: "Business name required", description: "Please enter your business or company name.", variant: "destructive" });
      return;
    }
    if (!newBizSlug.trim()) {
      toast({ title: "Subdomain slug required", description: "Please choose a subdomain identifier.", variant: "destructive" });
      return;
    }
    if (!newBizOwnerName.trim() || !newBizOwnerEmail.trim()) {
      toast({ title: "Owner details required", description: "Please provide your name and work email.", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      await apiPost("/api/auth/register-business", {
        businessName: newBizName,
        slug: newBizSlug,
        category: newBizCategory,
        ownerName: newBizOwnerName,
        ownerEmail: newBizOwnerEmail,
        brandColor: newBizColor,
      });
      await onLoggedIn();
      toast({
        title: "Business Created Successfully!",
        description: `Welcome to GS ClientFlow. Your business workspace '${newBizName}' is live.`,
      });
    } catch (err) {
      toast({ title: "Registration failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const selected = tenants.find((t) => t.slug === slug);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        {/* Pitch */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-lg grid place-items-center text-white bg-[var(--brand,#0f766e)]">
              <HeartPulse className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">GS ClientFlow</div>
              <div className="text-xs text-muted-foreground">multi-tenant client relationship OS</div>
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            Every client relationship, <span className="text-[var(--brand,#0f766e)]">automated</span> and measurable.
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl">
            Registration, feedback, birthday automation, campaigns, loyalty, appointments and genuine analytics —
            on a transactional-outbox event core with tenant isolation enforced at every layer.
          </p>
          <div className="mt-6 grid sm:grid-cols-2 gap-3">
            {[
              { icon: ShieldCheck, title: "Tenant isolation", desc: "Row-level security semantics enforced in the data-access layer — verified by a live test runner." },
              { icon: Workflow, title: "Event-driven automation", desc: "Outbox events with idempotent handlers, retries, backoff and a dead-letter queue." },
              { icon: Database, title: "Cursor pagination & indexes", desc: "Keyset pagination, tenant-scoped composite indexes, no over-fetching." },
              { icon: Palette, title: "White-label", desc: "Brand colors, custom domains with verification, embeddable widgets, per-tenant modules." },
            ].map((f) => (
              <Card key={f.title} className="p-4">
                <div className="flex items-start gap-3">
                  <f.icon className="h-4 w-4 mt-0.5 text-[var(--brand,#0f766e)]" />
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {eventCatalog.length > 0 && (
            <div className="mt-6">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Event contracts in this build</div>
              <div className="flex flex-wrap gap-1.5">
                {eventCatalog.map((e) => (
                  <Badge key={e.type} variant="outline" className="font-mono text-[10px]">{e.type}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sign in & Sign up Tabs */}
        <Card className="max-w-md w-full justify-self-center lg:justify-self-end">
          <Tabs defaultValue="login" className="w-full">
            <CardHeader className="pb-3">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="login" className="gap-1.5">
                  <LogIn className="h-4 w-4" /> Sign In
                </TabsTrigger>
                <TabsTrigger value="register" className="gap-1.5">
                  <Building2 className="h-4 w-4" /> Register Business
                </TabsTrigger>
              </TabsList>
            </CardHeader>

            {/* TAB 1: EXISTING BUSINESS LOGIN */}
            <TabsContent value="login">
              <CardContent className="space-y-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="tenant">Business</Label>
                  <Select value={slug} onValueChange={(v) => { setSlug(v); setEmail(DEMO_EMAILS[v] ?? ""); }}>
                    <SelectTrigger id="tenant">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => (
                        <SelectItem key={t.slug} value={t.slug}>
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 rounded grid place-items-center text-[9px] font-bold text-white" style={{ background: t.brandColor }}>
                              {t.logoText}
                            </span>
                            {t.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    {selected ? `${selected.businessCategory.replace("_", " ")} · ${selected.plan} plan` : ""}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Staff email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={DEMO_EMAILS[slug] ?? "you@example.com"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                  <div className="text-xs text-muted-foreground">
                    Demo accounts — {DEMO_EMAILS[slug] ?? "priya@auroraspa.example"} (owner) ·
                    platform@gsclientflow.app (cross-tenant demo admin)
                  </div>
                </div>

                <Button className="w-full gap-2" onClick={handleLogin} disabled={busy}>
                  <LogIn className="h-4 w-4" />
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Session cookie binds directly to this business tenant.
                </p>
              </CardContent>
            </TabsContent>

            {/* TAB 2: NEW BUSINESS SELF-SERVICE REGISTRATION */}
            <TabsContent value="register">
              <CardContent className="space-y-3.5 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="bizName">Business Name</Label>
                  <Input
                    id="bizName"
                    placeholder="e.g. Apex Physical Therapy"
                    value={newBizName}
                    onChange={(e) => {
                      setNewBizName(e.target.value);
                      if (!newBizSlug || newBizSlug === newBizName.toLowerCase().replace(/[^a-z0-9]/g, "-")) {
                        setNewBizSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-"));
                      }
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bizSlug">Subdomain</Label>
                    <Input
                      id="bizSlug"
                      placeholder="e.g. apex-pt"
                      value={newBizSlug}
                      onChange={(e) => setNewBizSlug(e.target.value)}
                    />
                    <span className="text-[10px] text-muted-foreground truncate block">
                      .{newBizSlug || "slug"}.gsclientflow.app
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="bizCat">Category</Label>
                    <Select value={newBizCategory} onValueChange={setNewBizCategory}>
                      <SelectTrigger id="bizCat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="salon_spa">Salon &amp; Spa</SelectItem>
                        <SelectItem value="dental">Dental Practice</SelectItem>
                        <SelectItem value="clinic">Medical Clinic</SelectItem>
                        <SelectItem value="retail">Boutique &amp; Retail</SelectItem>
                        <SelectItem value="food">Restaurant / Food</SelectItem>
                        <SelectItem value="services">Professional Services</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ownerName">Owner Name</Label>
                    <Input
                      id="ownerName"
                      placeholder="Elon Musk"
                      value={newBizOwnerName}
                      onChange={(e) => setNewBizOwnerName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bizColor">Brand Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id="bizColor"
                        value={newBizColor}
                        onChange={(e) => setNewBizColor(e.target.value)}
                        className="h-9 w-10 p-0 rounded border cursor-pointer bg-transparent"
                      />
                      <span className="font-mono text-xs">{newBizColor}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ownerEmail">Owner Work Email</Label>
                  <Input
                    id="ownerEmail"
                    type="email"
                    placeholder="elonmusk.ai@gmail.com"
                    value={newBizOwnerEmail}
                    onChange={(e) => setNewBizOwnerEmail(e.target.value)}
                  />
                </div>

                <Button className="w-full gap-2 mt-2" onClick={handleRegisterBusiness} disabled={busy}>
                  <PlusCircle className="h-4 w-4" />
                  {busy ? "Creating Business…" : "Create & Launch Business"}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Instantly provisions isolated database tenant, owner account, and workflows.
                </p>
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      <footer className="mt-auto border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 text-[11px] text-muted-foreground flex flex-wrap gap-x-4">
          <span className="font-medium">GS ClientFlow</span>
          <span>Enterprise multi-tenant client growth OS — strict row-level security isolation</span>
        </div>
      </footer>
    </div>
  );
}
