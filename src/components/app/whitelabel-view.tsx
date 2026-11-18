"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Globe, Plus, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost } from "@/lib/client/api";
import { formatDateTime, initials, timeAgo } from "@/lib/client/format";
import type { AppCtx, RegistrationField, TenantInfo, TenantSettings } from "@/lib/client/types";

// ---------------------------------------------------------------------------
// Local DTOs (mirrors of the API responses)
// ---------------------------------------------------------------------------

type TenantGetResponse = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    businessCategory: string;
    brandColor: string;
    logoText: string;
    plan: string;
    customDomain: string | null;
    domainVerifiedAt: string | null;
    domainVerifyToken: string | null;
  };
  settings: TenantSettings;
};

type WidgetPayload = {
  snippet: string;
  embedUrl: string;
  widgetPreview: { title: string; description: string; cta: string };
};

type ModuleKey = keyof TenantSettings["modules"];
type ChannelKey = "email" | "sms" | "whatsapp";
const CHANNEL_KEYS: ChannelKey[] = ["email", "sms", "whatsapp"];

const BRAND_PRESETS = [
  { name: "Teal", value: "#0f766e" },
  { name: "Emerald", value: "#059669" },
  { name: "Amber", value: "#a16207" },
  { name: "Rose", value: "#be185d" },
  { name: "Stone", value: "#57534e" },
];

const MODULE_DEFS: { key: ModuleKey; label: string; hint: string }[] = [
  { key: "appointments", label: "Appointments", hint: "Calendar, bookings and reminders." },
  { key: "loyalty", label: "Loyalty & rewards", hint: "Points, referrals and vouchers." },
  { key: "campaigns", label: "Campaigns", hint: "Bulk sends across channels." },
  { key: "feedback", label: "Feedback", hint: "Ratings, reviews and follow-ups." },
  { key: "whiteLabel", label: "White-label", hint: "Branding, domain and widget." },
];

const FIELD_KEYS = ["name", "email", "phone", "birthday", "address", "concern", "referral"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function defaultLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// ---------------------------------------------------------------------------
// Main view — Branding | Domain & widget | Registration | Modules | Automation
// ---------------------------------------------------------------------------

export default function WhiteLabelView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();

  // Local mirror of ctx.tenant, resynced from GET /api/tenant after every save.
  const [tenant, setTenant] = useState<TenantInfo>(ctx.tenant);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // Branding drafts
  const [nameDraft, setNameDraft] = useState(ctx.tenant.name);
  const [monogramDraft, setMonogramDraft] = useState(ctx.tenant.logoText);
  const [colorDraft, setColorDraft] = useState(ctx.tenant.brandColor);

  // Domain drafts
  const [domainInput, setDomainInput] = useState("");

  // Registration form builder
  const [fieldsDraft, setFieldsDraft] = useState<RegistrationField[]>(ctx.tenant.settings.registrationFields);
  const [newKey, setNewKey] = useState<FieldKey>("phone");
  const [newLabel, setNewLabel] = useState("");
  const [newRequired, setNewRequired] = useState(false);
  const [newActive, setNewActive] = useState(true);

  // Email sender drafts
  const [emailDraft, setEmailDraft] = useState({ fromName: "", fromEmail: "" });

  // Automation + retention drafts
  const [automationDraft, setAutomationDraft] = useState({ birthdayLeadDays: "", inactiveDays: "" });
  const [retentionDraft, setRetentionDraft] = useState({
    archiveInactiveDays: "",
    feedbackRetentionMonths: "",
    eventRetentionDays: "",
  });

  // Widget snippet
  const [widget, setWidget] = useState<WidgetPayload | null>(null);
  const [widgetLoading, setWidgetLoading] = useState(true);

  const resync = useCallback(async () => {
    const res = await apiGet<TenantGetResponse>("/api/tenant");
    const { domainVerifyToken, ...tenantPatch } = res.tenant;
    setTenant((prev) => ({ ...prev, ...tenantPatch, settings: res.settings ?? prev.settings }));
    setVerifyToken(domainVerifyToken);
  }, []);

  useEffect(() => {
    void resync().catch((err) => {
      toast({ title: "Could not sync settings", description: (err as Error).message, variant: "destructive" });
    });
  }, [resync, toast]);

  useEffect(() => {
    let alive = true;
    apiGet<WidgetPayload>("/api/tenant/widget")
      .then((res) => {
        if (alive) setWidget(res);
      })
      .catch((err) => {
        if (alive) toast({ title: "Could not load widget snippet", description: (err as Error).message, variant: "destructive" });
      })
      .finally(() => {
        if (alive) setWidgetLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  // Re-hydrate editable state whenever the tenant mirror changes (after saves).
  useEffect(() => {
    setNameDraft(tenant.name);
    setMonogramDraft(tenant.logoText);
    setColorDraft(tenant.brandColor);
    setFieldsDraft(tenant.settings.registrationFields);
    setEmailDraft({
      fromName: tenant.settings.channels.email.fromName ?? "",
      fromEmail: tenant.settings.channels.email.fromEmail ?? "",
    });
    setAutomationDraft({
      birthdayLeadDays: String(tenant.settings.birthdayLeadDays),
      inactiveDays: String(tenant.settings.inactiveDays),
    });
    setRetentionDraft({
      archiveInactiveDays: String(tenant.settings.retention.archiveInactiveDays),
      feedbackRetentionMonths: String(tenant.settings.retention.feedbackRetentionMonths),
      eventRetentionDays: String(tenant.settings.retention.eventRetentionDays),
    });
  }, [tenant]);

  // ------------------------------------------------------------------ saves

  const saveBranding = async () => {
    const name = nameDraft.trim();
    if (!name) {
      toast({ title: "Business name is required", variant: "destructive" });
      return;
    }
    setSaving("branding");
    try {
      await apiPatch("/api/tenant", {
        section: "branding",
        patch: { name, brandColor: colorDraft, logoText: monogramDraft.trim().slice(0, 3) },
      });
      toast({
        title: "Brand saved",
        description: "Visible across the app instantly — re-sign-in not required; the shell reads brand at session level.",
      });
      await resync();
    } catch (err) {
      toast({ title: "Could not save branding", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const saveFields = async () => {
    setSaving("fields");
    try {
      await apiPatch("/api/tenant", { section: "registrationFields", patch: { fields: fieldsDraft } });
      toast({ title: "Registration form saved" });
      await resync();
    } catch (err) {
      toast({ title: "Could not save the form", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const toggleModule = async (def: { key: ModuleKey; label: string }, value: boolean) => {
    setTenant((t) => ({ ...t, settings: { ...t.settings, modules: { ...t.settings.modules, [def.key]: value } } }));
    setToggling(def.key);
    try {
      await apiPatch("/api/tenant", { section: "modules", patch: { [def.key]: value } });
      toast({ title: "Module toggled", description: `${def.label} ${value ? "enabled" : "disabled"}.` });
      await resync();
    } catch (err) {
      setTenant((t) => ({ ...t, settings: { ...t.settings, modules: { ...t.settings.modules, [def.key]: !value } } }));
      toast({ title: "Could not toggle module", description: (err as Error).message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const saveChannel = async (channel: ChannelKey, value: boolean) => {
    const label = tenant.settings.channels[channel].label || channel;
    const patch: { channel: string; enabled: boolean; fromName?: string; fromEmail?: string } = { channel, enabled: value };
    if (channel === "email") {
      if (emailDraft.fromName.trim()) patch.fromName = emailDraft.fromName.trim();
      if (emailDraft.fromEmail.trim()) patch.fromEmail = emailDraft.fromEmail.trim();
    }
    setTenant((t) => ({
      ...t,
      settings: { ...t.settings, channels: { ...t.settings.channels, [channel]: { ...t.settings.channels[channel], enabled: value } } },
    }));
    setToggling(`channel-${channel}`);
    try {
      await apiPatch("/api/tenant", { section: "channels", patch });
      toast({ title: "Channel saved", description: `${label} ${value ? "enabled" : "disabled"}.` });
      await resync();
    } catch (err) {
      setTenant((t) => ({
        ...t,
        settings: { ...t.settings, channels: { ...t.settings.channels, [channel]: { ...t.settings.channels[channel], enabled: !value } } },
      }));
      toast({ title: "Could not save channel", description: (err as Error).message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const saveEmailSender = async () => {
    setSaving("email");
    try {
      await apiPatch("/api/tenant", {
        section: "channels",
        patch: {
          channel: "email",
          enabled: tenant.settings.channels.email.enabled,
          ...(emailDraft.fromName.trim() ? { fromName: emailDraft.fromName.trim() } : {}),
          ...(emailDraft.fromEmail.trim() ? { fromEmail: emailDraft.fromEmail.trim() } : {}),
        },
      });
      toast({ title: "Channel saved", description: "Email sender identity updated." });
      await resync();
    } catch (err) {
      toast({ title: "Could not save channel", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const saveAutomation = async () => {
    setSaving("automation");
    try {
      await apiPatch("/api/tenant", {
        section: "automation",
        patch: {
          birthdayLeadDays: Number(automationDraft.birthdayLeadDays) || 0,
          inactiveDays: Number(automationDraft.inactiveDays) || 0,
        },
      });
      toast({ title: "Automation settings saved", description: "Birthday and win-back journeys now use these lead times." });
      await resync();
    } catch (err) {
      toast({ title: "Could not save automation", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const saveRetention = async () => {
    setSaving("retention");
    try {
      await apiPatch("/api/tenant", {
        section: "retention",
        patch: {
          archiveInactiveDays: Number(retentionDraft.archiveInactiveDays) || 0,
          feedbackRetentionMonths: Number(retentionDraft.feedbackRetentionMonths) || 0,
          eventRetentionDays: Number(retentionDraft.eventRetentionDays) || 0,
        },
      });
      toast({ title: "Retention policy saved" });
      await resync();
    } catch (err) {
      toast({ title: "Could not save retention", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  // ------------------------------------------------------------------ domain

  const configureDomain = async () => {
    const domain = domainInput.trim();
    if (!domain) {
      toast({ title: "Enter a domain first", variant: "destructive" });
      return;
    }
    setSaving("domain");
    try {
      await apiPost("/api/tenant/domain", { action: "configure", domain });
      setDomainInput("");
      toast({ title: "Domain configured", description: "Verification token issued — add the TXT record below, then verify." });
      await resync();
    } catch (err) {
      toast({ title: "Could not configure domain", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const verifyDomainNow = async () => {
    setSaving("verify");
    try {
      const res = await apiPost<{ domain: string | null; verified: boolean }>("/api/tenant/domain", { action: "verify" });
      if (res.verified) {
        toast({ title: "Domain verified", description: `${tenant.customDomain ?? res.domain} is live on your workspace.` });
        await resync();
      } else {
        toast({ title: "Verification pending", description: "TXT record not found yet — try again once the record propagates.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Verification failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const copySnippet = async () => {
    if (!widget) return;
    try {
      await navigator.clipboard.writeText(widget.snippet);
      toast({ title: "Snippet copied" });
    } catch {
      toast({ title: "Copy failed", description: "Select the snippet text and copy it manually.", variant: "destructive" });
    }
  };

  // ------------------------------------------------------- registration form

  const updateField = (index: number, patch: Partial<RegistrationField>) => {
    setFieldsDraft((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const addField = () => {
    if (fieldsDraft.some((f) => f.key === newKey)) {
      toast({ title: "Field already exists", description: `A ${newKey} field is already on the form.`, variant: "destructive" });
      return;
    }
    setFieldsDraft((prev) => [...prev, { key: newKey, label: newLabel.trim() || defaultLabel(newKey), required: newRequired, active: newActive }]);
    setNewLabel("");
    setNewRequired(false);
    setNewActive(true);
    toast({ title: "Field added", description: "Remember to save the form." });
  };

  // ------------------------------------------------------------------- view

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">White-label &amp; Settings</h1>
        <p className="text-sm text-muted-foreground">Your brand on every client-facing surface.</p>
      </div>

      <Tabs defaultValue="branding" className="gap-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <TabsTrigger value="branding" className="flex-1 text-xs sm:text-sm">Branding</TabsTrigger>
          <TabsTrigger value="domain" className="flex-1 text-xs sm:text-sm">
            <span className="sm:hidden">Domain</span>
            <span className="hidden sm:inline">Domain &amp; widget</span>
          </TabsTrigger>
          <TabsTrigger value="registration" className="flex-1 text-xs sm:text-sm">
            <span className="sm:hidden">Form</span>
            <span className="hidden sm:inline">Registration</span>
          </TabsTrigger>
          <TabsTrigger value="modules" className="flex-1 text-xs sm:text-sm">
            <span className="sm:hidden">Modules</span>
            <span className="hidden sm:inline">Modules &amp; channels</span>
          </TabsTrigger>
          <TabsTrigger value="automation" className="flex-1 text-xs sm:text-sm">
            <span className="sm:hidden">Automation</span>
            <span className="hidden sm:inline">Automation &amp; retention</span>
          </TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------------------- Branding */}
        <TabsContent value="branding" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Brand basics</CardTitle>
                <CardDescription>Name, monogram and accent color used across the shell and client surfaces.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 px-4 py-4 sm:px-6">
                <div className="space-y-1.5">
                  <Label htmlFor="brand-name">Business name</Label>
                  <Input id="brand-name" className="h-10" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-monogram">Monogram (up to 3 letters)</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="brand-monogram"
                      maxLength={3}
                      className="h-10 w-24 font-medium uppercase"
                      value={monogramDraft}
                      onChange={(e) => setMonogramDraft(e.target.value)}
                    />
                    <div aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-lg bg-[var(--brand)] text-lg font-semibold uppercase text-white">
                      {monogramDraft || initials(nameDraft) || "GS"}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Brand color</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {BRAND_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        aria-label={`Use ${p.name} brand color`}
                        aria-pressed={colorDraft === p.value}
                        onClick={() => setColorDraft(p.value)}
                        className={`h-10 w-10 rounded-lg border-2 transition-shadow ${
                          colorDraft === p.value ? "border-transparent ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-border"
                        }`}
                        style={{ backgroundColor: p.value }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="Custom brand color"
                      className="h-10 w-14 cursor-pointer rounded-md border bg-background p-1"
                      value={/^#[0-9a-fA-F]{6}$/.test(colorDraft) ? colorDraft : "#0f766e"}
                      onChange={(e) => setColorDraft(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="capitalize">{tenant.plan} plan</Badge>
                  <Badge variant="outline" className="capitalize">{tenant.businessCategory.replace(/_/g, " ")}</Badge>
                  <span className="font-mono">{tenant.slug}.gsclientflow.app</span>
                </div>
              </CardContent>
              <CardFooter className="justify-between gap-3 border-t px-4 py-4 sm:px-6">
                <p className="text-xs text-muted-foreground">Re-sign-in not required; the shell reads brand at session level.</p>
                <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving === "branding"} onClick={() => void saveBranding()}>
                  {saving === "branding" ? "Saving…" : "Save brand"}
                </Button>
              </CardFooter>
            </Card>

            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">{nameDraft || "Your business"} — client portal preview</CardTitle>
                <CardDescription>A live look at the client-facing hero as clients will see it.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 py-4 sm:px-6">
                <div className="overflow-hidden rounded-xl border">
                  <div className="p-6" style={{ backgroundColor: colorDraft }}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/15 text-sm font-semibold uppercase text-white" aria-hidden="true">
                        {monogramDraft || initials(nameDraft) || "GS"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold text-white">{nameDraft || "Your business"}</p>
                        <p className="truncate text-xs text-white/75 capitalize">{tenant.businessCategory.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="max-w-sm text-sm text-white/80">Welcome back — your visits, points and reminders in one place.</p>
                      <span className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-white px-4 text-sm font-medium" style={{ color: colorDraft }}>
                        Book your visit
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* -------------------------------------------------------- Domain & widget */}
        <TabsContent value="domain" className="space-y-4">
          <Card className="py-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-sm font-medium">Subdomain</p>
                <p className="truncate font-mono text-sm text-muted-foreground">{tenant.slug}.gsclientflow.app</p>
              </div>
              <Badge variant="secondary">Included automatically</Badge>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-[var(--brand)]" /> Custom domain
              </CardTitle>
              <CardDescription>Point your own domain at this workspace and verify it with a DNS TXT record.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4 py-4 sm:px-6">
              {tenant.customDomain ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{tenant.customDomain}</span>
                    {tenant.domainVerifiedAt ? (
                      <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700">
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-600 bg-amber-600/10 text-[10px] text-amber-700">
                        Pending verification
                      </Badge>
                    )}
                  </div>
                  {tenant.domainVerifiedAt && (
                    <p className="text-xs text-muted-foreground">verified {timeAgo(tenant.domainVerifiedAt)} · {formatDateTime(tenant.domainVerifiedAt)}</p>
                  )}
                  {!tenant.domainVerifiedAt && (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <p className="text-xs font-medium">DNS verification</p>
                      <p className="text-xs text-muted-foreground">Add this TXT record at your DNS provider:</p>
                      <div className="space-y-1 rounded-md bg-muted p-2 font-mono text-[11px]">
                        <p className="break-all">_gscf-verify.{tenant.customDomain}</p>
                        <p className="break-all text-[var(--brand)]">{verifyToken ?? "token pending"}</p>
                      </div>
                      <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving === "verify"} onClick={() => void verifyDomainNow()}>
                        {saving === "verify" ? "Verifying…" : "Verify now"}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No custom domain yet — you are on <span className="font-mono">{tenant.slug}.gsclientflow.app</span>. Configure one below any time.
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="domain-input">{tenant.customDomain ? "Change domain" : "Your domain"}</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="domain-input"
                    className="h-10"
                    placeholder="booking.yourbusiness.com"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                  />
                  <Button variant="outline" className="h-10 shrink-0" disabled={saving === "domain"} onClick={() => void configureDomain()}>
                    {saving === "domain" ? "Configuring…" : "Configure"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Sandbox: DNS check is simulated; production performs a live TXT lookup.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Embeddable widget</CardTitle>
              <CardDescription>A branded booking block for any website.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-2">
              <div className="space-y-3">
                {widgetLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : widget ? (
                  <>
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground" aria-label="Widget embed snippet">
                      {widget.snippet}
                    </pre>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" className="h-10 gap-1.5" onClick={() => void copySnippet()}>
                        <Copy className="h-4 w-4" /> Copy snippet
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        embeds at <span className="font-mono">{widget.embedUrl}</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>Snippet unavailable</AlertTitle>
                    <AlertDescription>Reload the page to retry fetching the widget snippet.</AlertDescription>
                  </Alert>
                )}
                <p className="text-xs text-muted-foreground">
                  Drop the snippet into any website — bookings, registrations and feedback flow into this workspace.
                </p>
              </div>
              <div className="mx-auto w-full max-w-xs overflow-hidden rounded-xl border shadow-sm" aria-label="Widget preview">
                <div className="flex items-center gap-2 p-3" style={{ backgroundColor: tenant.brandColor }}>
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white/20 text-[10px] font-bold uppercase text-white" aria-hidden="true">
                    {tenant.logoText}
                  </span>
                  <span className="truncate text-xs font-semibold text-white">{tenant.name}</span>
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-sm font-medium">{widget?.widgetPreview.title ?? "Book in 30 seconds"}</p>
                  <p className="text-xs text-muted-foreground">
                    {widget?.widgetPreview.description ?? "Check availability and confirm instantly."}
                  </p>
                  <span
                    className="inline-flex h-9 w-full items-center justify-center rounded-md text-xs font-medium text-white"
                    style={{ backgroundColor: tenant.brandColor }}
                  >
                    {widget?.widgetPreview.cta ?? "Find a slot"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- Registration */}
        <TabsContent value="registration" className="space-y-4">
          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Registration form builder</CardTitle>
              <CardDescription>These fields drive the public registration page and the client portal in real time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 py-4 sm:px-6">
              {fieldsDraft.length ? (
                fieldsDraft.map((f, i) => (
                  <div key={`${f.key}-${i}`} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                    <div className="grid flex-1 gap-3 sm:grid-cols-[120px_1fr]">
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Field</p>
                        <Badge variant="outline" className="font-mono text-[10px]">{f.key}</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`field-label-${i}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">Label</Label>
                        <Input id={`field-label-${i}`} className="h-10" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Switch id={`field-required-${i}`} checked={f.required} onCheckedChange={(v) => updateField(i, { required: v })} />
                        <Label htmlFor={`field-required-${i}`} className="text-xs text-muted-foreground">Required</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id={`field-active-${i}`} checked={f.active} onCheckedChange={(v) => updateField(i, { active: v })} />
                        <Label htmlFor={`field-active-${i}`} className="text-xs text-muted-foreground">Active</Label>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0"
                        aria-label={`Remove ${f.key} field`}
                        onClick={() => setFieldsDraft((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No fields yet — add the first one below.</p>
              )}

              {/* Add field */}
              <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center">
                <div className="grid flex-1 gap-3 sm:grid-cols-[120px_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor="new-field-key" className="text-[10px] uppercase tracking-wide text-muted-foreground">Key</Label>
                    <Select value={newKey} onValueChange={(v) => setNewKey(v as FieldKey)}>
                      <SelectTrigger id="new-field-key" className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_KEYS.map((k) => (
                          <SelectItem key={k} value={k} disabled={fieldsDraft.some((f) => f.key === k)}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-field-label" className="text-[10px] uppercase tracking-wide text-muted-foreground">Label</Label>
                    <Input id="new-field-label" className="h-10" placeholder={defaultLabel(newKey)} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch id="new-field-required" checked={newRequired} onCheckedChange={setNewRequired} />
                    <Label htmlFor="new-field-required" className="text-xs text-muted-foreground">Required</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="new-field-active" checked={newActive} onCheckedChange={setNewActive} />
                    <Label htmlFor="new-field-active" className="text-xs text-muted-foreground">Active</Label>
                  </div>
                  <Button variant="outline" className="h-10 shrink-0 gap-1.5" onClick={addField}>
                    <Plus className="h-4 w-4" /> Add field
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between gap-3 border-t px-4 py-4 sm:px-6">
              <p className="text-xs text-muted-foreground">{fieldsDraft.filter((f) => f.active).length} active field(s) — changes go live on save.</p>
              <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving === "fields"} onClick={() => void saveFields()}>
                {saving === "fields" ? "Saving…" : "Save form"}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- Modules & channels */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Modules</CardTitle>
                <CardDescription>Toggle product areas per workspace — the corresponding views appear or vanish instantly.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {MODULE_DEFS.map((m) => (
                    <div key={m.key} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.hint}</p>
                      </div>
                      <Switch
                        checked={tenant.settings.modules[m.key]}
                        disabled={toggling === m.key}
                        onCheckedChange={(v) => void toggleModule(m, v)}
                        aria-label={`${m.label} module`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Channels</CardTitle>
                <CardDescription>
                  Sandbox uses a deterministic simulated provider; production swaps in your email/SMS/WhatsApp gateway
                  without touching the outbox pipeline.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {CHANNEL_KEYS.map((ch) => {
                    const cfg = tenant.settings.channels[ch];
                    return (
                      <div key={ch} className="space-y-3 px-4 py-3 sm:px-6">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-sm font-medium capitalize">{cfg.label || ch}</p>
                          <Switch
                            checked={cfg.enabled}
                            disabled={toggling === `channel-${ch}`}
                            onCheckedChange={(v) => void saveChannel(ch, v)}
                            aria-label={`${ch} channel`}
                          />
                        </div>
                        {ch === "email" && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="email-from-name" className="text-xs text-muted-foreground">From name</Label>
                              <Input
                                id="email-from-name"
                                className="h-10"
                                placeholder={cfg.fromName || "Your business"}
                                value={emailDraft.fromName}
                                onChange={(e) => setEmailDraft((d) => ({ ...d, fromName: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="email-from-email" className="text-xs text-muted-foreground">From email</Label>
                              <Input
                                id="email-from-email"
                                type="email"
                                className="h-10"
                                placeholder={cfg.fromEmail || "hello@yourbusiness.com"}
                                value={emailDraft.fromEmail}
                                onChange={(e) => setEmailDraft((d) => ({ ...d, fromEmail: e.target.value }))}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <Button variant="outline" size="sm" className="h-9" disabled={saving === "email"} onClick={() => void saveEmailSender()}>
                                {saving === "email" ? "Saving…" : "Save sender identity"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ------------------------------------------------- Automation & retention */}
        <TabsContent value="automation" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Automation windows</CardTitle>
                <CardDescription>Lead times for birthday greetings and inactive win-back journeys.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-6">
                <div className="space-y-1.5">
                  <Label htmlFor="birthday-lead">Birthday lead days</Label>
                  <Input
                    id="birthday-lead"
                    type="number"
                    min={0}
                    className="h-10"
                    value={automationDraft.birthdayLeadDays}
                    onChange={(e) => setAutomationDraft((d) => ({ ...d, birthdayLeadDays: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Greeting is scheduled this many days ahead of the birthday.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inactive-days">Inactive after (days)</Label>
                  <Input
                    id="inactive-days"
                    type="number"
                    min={0}
                    className="h-10"
                    value={automationDraft.inactiveDays}
                    onChange={(e) => setAutomationDraft((d) => ({ ...d, inactiveDays: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">No visit for this long marks a customer inactive for win-back.</p>
                </div>
              </CardContent>
              <CardFooter className="justify-end border-t px-4 py-4 sm:px-6">
                <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving === "automation"} onClick={() => void saveAutomation()}>
                  {saving === "automation" ? "Saving…" : "Save automation"}
                </Button>
              </CardFooter>
            </Card>

            <Card className="gap-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Retention policy</CardTitle>
                <CardDescription>
                  Customers inactive beyond the archive window are archived (never hard-deleted) by the retention sweep;
                  events older than eventRetentionDays are pruned.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-3 sm:px-6">
                <div className="space-y-1.5">
                  <Label htmlFor="archive-days">Archive after (days)</Label>
                  <Input
                    id="archive-days"
                    type="number"
                    min={0}
                    className="h-10"
                    value={retentionDraft.archiveInactiveDays}
                    onChange={(e) => setRetentionDraft((d) => ({ ...d, archiveInactiveDays: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="feedback-retention">Feedback retention (months)</Label>
                  <Input
                    id="feedback-retention"
                    type="number"
                    min={0}
                    className="h-10"
                    value={retentionDraft.feedbackRetentionMonths}
                    onChange={(e) => setRetentionDraft((d) => ({ ...d, feedbackRetentionMonths: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-retention">Event retention (days)</Label>
                  <Input
                    id="event-retention"
                    type="number"
                    min={0}
                    className="h-10"
                    value={retentionDraft.eventRetentionDays}
                    onChange={(e) => setRetentionDraft((d) => ({ ...d, eventRetentionDays: e.target.value }))}
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end border-t px-4 py-4 sm:px-6">
                <Button className="h-10 bg-[var(--brand)] text-white hover:opacity-90" disabled={saving === "retention"} onClick={() => void saveRetention()}>
                  {saving === "retention" ? "Saving…" : "Save retention"}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
