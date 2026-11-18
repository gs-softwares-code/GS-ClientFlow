"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, Check, Clock, Gift, Globe, Phone, Search, Sparkles, Star, Ticket, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/client/api";
import { formatDate, formatINR } from "@/lib/client/format";
import type { AppCtx, RegistrationField } from "@/lib/client/types";

/* ---------- DTOs (mirrors of the API responses) ---------- */

type PortalService = { id: string; name: string; durationMin: number; priceCents: number };

type PortalCoupon = { code: string; title: string; expiresAt: string | null };

type PortalWallet = {
  name: string;
  pointsBalance: number;
  visitCount: number;
  lifetimeSpendCents: number;
  tier: string;
  coupons: PortalCoupon[];
  referralCode: string;
};

type PortalResponse = {
  brand: { brandColor: string; logoText: string; name: string };
  modules: { appointments: boolean; loyalty: boolean; campaigns: boolean; feedback: boolean; whiteLabel: boolean };
  registrationFields: RegistrationField[];
  loyaltyEnabled: boolean;
  services: PortalService[];
  wallet?: PortalWallet | null;
};

/* ---------- helpers ---------- */

function makeSandboxToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `sandbox-${out}`;
}

function taglineFor(category: string): string {
  if (category === "salon_spa") return "Rituals, results and a little calm";
  if (category === "dental") return "Gentle, modern dentistry";
  return "Book, belong, be remembered";
}

/** Dashed sandbox captcha card — the issued token is validated server-side. */
function SandboxCaptcha({ token, onVerify }: { token: string | null; onVerify: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Sandbox Turnstile</div>
          <div className="text-[11px] text-muted-foreground">
            {token ? "Token issued — validated server-side on submit." : "Human check — verify to receive a sandbox token."}
          </div>
        </div>
        {token ? (
          <Badge variant="outline" className="gap-1 border-emerald-600 bg-emerald-600/10 text-emerald-700">
            <BadgeCheck className="h-3 w-3" /> Verified
          </Badge>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onVerify}>
            Verify
          </Button>
        )}
      </div>
    </div>
  );
}

function submitButton(label: string, submitting: boolean): string {
  return submitting ? "Sending…" : label;
}

/* ========================================================================= *
 * REGISTER — public registration form driven by the tenant's form config
 * ========================================================================= */

function RegisterTab({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const fields = ctx.tenant.settings.registrationFields.filter((f) => f.active);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consentMarketing, setConsentMarketing] = useState(true);
  const [consentSms, setConsentSms] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const setValue = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast({
        title: "Complete the human check first",
        description: "The registration endpoint rejects requests without a valid captcha token.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ message: string }>(`/api/public/register?tenant=${ctx.tenant.slug}`, {
        name: values.name ?? "",
        email: values.email ?? "",
        phone: values.phone ?? "",
        birthday: values.birthday ?? "",
        referredByCode: values.referral ?? "",
        concern: values.concern ?? "",
        consentMarketing,
        consentSms,
        consentWhatsapp,
        turnstileToken: token,
      });
      toast({ title: res.message });
      setDone(res.message);
      setToken(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast({
        title: status === 409 ? "Already registered" : "Registration failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Register as a customer</CardTitle>
        <CardDescription>Fields driven by this business&apos;s registration form configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done && (
          <Alert className="border-emerald-600/40">
            <Check className="text-emerald-600" />
            <AlertTitle>{done}</AlertTitle>
            <AlertDescription>
              customer.registered event queued → onboarding workflow (2 min delay) + referral attribution if a code was used.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `reg-${f.key}`;
              if (f.key === "concern") {
                return (
                  <div key={f.key} className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={id}>{f.label}</Label>
                    <Textarea
                      id={id}
                      rows={3}
                      required={f.required}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      placeholder="Tell us what matters to you"
                    />
                  </div>
                );
              }
              if (f.key === "referral") {
                return (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={id}>{f.label}</Label>
                    <Input
                      id={id}
                      required={f.required}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValue(f.key, e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">Have a friend&apos;s code?</p>
                  </div>
                );
              }
              const type = f.key === "email" ? "email" : f.key === "birthday" ? "date" : "text";
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={id}>{f.label}</Label>
                  <Input
                    id={id}
                    type={type}
                    required={f.required}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                </div>
              );
            })}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium">Consent</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={consentMarketing} onCheckedChange={(c) => setConsentMarketing(c === true)} />
                Email marketing
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={consentSms} onCheckedChange={(c) => setConsentSms(c === true)} />
                SMS
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={consentWhatsapp} onCheckedChange={(c) => setConsentWhatsapp(c === true)} />
                WhatsApp
              </label>
            </div>
          </div>

          <SandboxCaptcha token={token} onVerify={() => setToken(makeSandboxToken())} />

          <Button type="submit" className="gap-1.5" disabled={submitting}>
            {submitButton("Create my registration", submitting)}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ========================================================================= *
 * FEEDBACK — star rating, comment, email lookup, captcha
 * ========================================================================= */

function FeedbackTab({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast({ title: "Complete the human check first", variant: "destructive" });
      return;
    }
    if (rating < 1) {
      toast({ title: "Pick a star rating first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ message: string }>(`/api/public/feedback?tenant=${ctx.tenant.slug}`, {
        email,
        rating,
        comment,
        turnstileToken: token,
      });
      toast({ title: "Thank you! Your points are being credited.", description: res.message });
      setDone(true);
      setToken(null);
      setRating(0);
      setComment("");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        toast({
          title: "No registration found for this email — register first",
          description: "Register on the Register tab, then share your experience and earn points.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Could not submit feedback", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Share your experience</CardTitle>
        <CardDescription>Your email links the rating to your customer record — points are credited automatically</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done && (
          <Alert className="border-emerald-600/40">
            <Check className="text-emerald-600" />
            <AlertTitle>Feedback received</AlertTitle>
            <AlertDescription>feedback.submitted event queued — follow-up workflows will act on the rating.</AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rating</Label>
            <div className="flex gap-1" role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  onClick={() => setRating(n)}
                  className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star className={`h-6 w-6 ${rating >= n ? "fill-amber-500 text-amber-500" : "text-muted-foreground/40"}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fb-email">Your email</Label>
              <Input
                id="fb-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-comment">Comment</Label>
            <Textarea
              id="fb-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What went well? What could be better?"
            />
          </div>

          <SandboxCaptcha token={token} onVerify={() => setToken(makeSandboxToken())} />

          <Button type="submit" className="gap-1.5" disabled={submitting}>
            {submitButton("Submit feedback", submitting)}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ========================================================================= *
 * BOOK A VISIT — service catalog + booking form (module-gated)
 * ========================================================================= */

function BookTab({ ctx, info, appointmentsOn }: { ctx: AppCtx; info: PortalResponse | null; appointmentsOn: boolean }) {
  const { toast } = useToast();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("11:00");
  const [note, setNote] = useState("");
  const [haircutStyle, setHaircutStyle] = useState("Classic & Textured");
  const [musicGenre, setMusicGenre] = useState("Lo-Fi Beats");
  const [beverage, setBeverage] = useState("Espresso");
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState(false);

  if (!appointmentsOn) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">This business takes bookings by phone</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Appointments are switched off for {ctx.tenant.name} — call to reserve a slot.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!serviceId) {
      toast({ title: "Pick a service first", variant: "destructive" });
      return;
    }
    if (!token) {
      toast({ title: "Complete the human check first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ message: string }>(`/api/public/book?tenant=${ctx.tenant.slug}`, {
        email,
        name,
        serviceId,
        startAt: new Date(`${date}T${time}`).toISOString(),
        note,
        preferences: {
          haircutStyle,
          musicGenre,
          beverage,
          notes: note,
        },
        turnstileToken: token,
      });
      toast({ title: res.message });
      setBooked(true);
      setToken(null);
      setNote("");
    } catch (err) {
      toast({ title: "Booking failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Choose a service</CardTitle>
          <CardDescription>Published catalog with duration and price</CardDescription>
        </CardHeader>
        <CardContent>
          {!info ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-[86px] rounded-xl" />
              ))}
            </div>
          ) : info.services.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {info.services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={serviceId === s.id}
                  onClick={() => setServiceId(s.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    serviceId === s.id ? "border-[var(--brand)] bg-[var(--brand)]/5 ring-1 ring-[var(--brand)]" : "hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{s.name}</div>
                    {serviceId === s.id && (
                      <Badge className="border-transparent bg-[var(--brand)] text-[10px] text-white">Selected</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {s.durationMin} min
                    <span className="ml-auto font-semibold text-foreground">{formatINR(s.priceCents)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No services published yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Book your visit</CardTitle>
          <CardDescription>
            {booked ? "Your previous booking created your customer record — email is enough from here on." : "Pick a slot and we will confirm instantly."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {booked && (
            <Alert className="mb-4 border-emerald-600/40">
              <Check className="text-emerald-600" />
              <AlertTitle>Booked</AlertTitle>
              <AlertDescription>appointment.booked event queued — confirmation and reminders are on their way.</AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bk-email">Email</Label>
                <Input
                  id="bk-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {!booked && (
                <div className="space-y-1.5">
                  <Label htmlFor="bk-name">Name</Label>
                  <Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                  <p className="text-[11px] text-muted-foreground">New here? Name + email creates your customer record automatically</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bk-date">Date</Label>
                <Input id="bk-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-time">Time</Label>
                <Input id="bk-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            {/* Ambient Visit Preferences (Smart Salon / Spa) */}
            <div className="rounded-lg border bg-muted/40 p-3.5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                Personalize Your Visit Experience (Ambient Concierge)
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="bk-style" className="text-xs">Preferred Style</Label>
                  <Input
                    id="bk-style"
                    className="h-8 text-xs"
                    value={haircutStyle}
                    onChange={(e) => setHaircutStyle(e.target.value)}
                    placeholder="e.g. Fade Cut, Balayage, Layered"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bk-music" className="text-xs">Lounge Music</Label>
                  <Select value={musicGenre} onValueChange={setMusicGenre}>
                    <SelectTrigger id="bk-music" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Lo-Fi Beats">Lo-Fi Beats</SelectItem>
                      <SelectItem value="Acoustic Chill">Acoustic Chill</SelectItem>
                      <SelectItem value="Deep House">Deep House</SelectItem>
                      <SelectItem value="Classical">Classical</SelectItem>
                      <SelectItem value="Silence / Quiet">Silence / Quiet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bk-beverage" className="text-xs">Welcome Drink</Label>
                  <Select value={beverage} onValueChange={setBeverage}>
                    <SelectTrigger id="bk-beverage" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Espresso">Fresh Espresso</SelectItem>
                      <SelectItem value="Green Tea">Herbal Green Tea</SelectItem>
                      <SelectItem value="Sparkling Water">Sparkling Water</SelectItem>
                      <SelectItem value="Iced Latte">Iced Latte</SelectItem>
                      <SelectItem value="None">None / Water Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bk-note">Note</Label>
              <Input
                id="bk-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything we should know before you arrive?"
              />
            </div>

            <SandboxCaptcha token={token} onVerify={() => setToken(makeSandboxToken())} />

            <Button type="submit" className="gap-1.5" disabled={submitting}>
              {submitButton("Book a visit", submitting)}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ========================================================================= *
 * MY WALLET — email lookup against the public portal API
 * ========================================================================= */

function WalletTab({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState<PortalWallet | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNotFound(false);
    try {
      const res = await apiGet<PortalResponse>(`/api/public/portal?tenant=${ctx.tenant.slug}&email=${encodeURIComponent(email)}`);
      setWallet(res.wallet ?? null);
      if (!res.wallet) setNotFound(true);
    } catch (err) {
      toast({ title: "Lookup failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-[var(--brand)]" /> Look up my wallet
          </CardTitle>
          <CardDescription>Enter the email you registered with</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor="wl-email">Email</Label>
              <Input
                id="wl-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <Button type="submit" size="sm" className="gap-1.5" disabled={loading}>
              {loading ? <Search className="h-3.5 w-3.5 animate-pulse" /> : <Search className="h-3.5 w-3.5" />}
              {loading ? "Looking up…" : "Find my wallet"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {notFound && (
        <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          No wallet found for this email — register first to start earning points.
        </div>
      )}

      {wallet && (
        <Card className="overflow-hidden p-0">
          <div className="p-5 text-white" style={{ backgroundColor: ctx.tenant.brandColor }}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{wallet.name}</div>
              <Badge className="border-transparent bg-white/20 text-white capitalize">{wallet.tier} tier</Badge>
            </div>
            <div className="mt-3 text-4xl font-bold tabular-nums">{wallet.pointsBalance.toLocaleString()}</div>
            <div className="text-[11px] text-white/85">loyalty points balance</div>
          </div>
          <CardContent className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Visits</div>
                <div className="text-xl font-semibold tabular-nums">{wallet.visitCount}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Lifetime spend</div>
                <div className="text-xl font-semibold tabular-nums">{formatINR(wallet.lifetimeSpendCents)}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <Ticket className="h-3.5 w-3.5 text-[var(--brand)]" /> Active coupons
              </div>
              {wallet.coupons.length ? (
                <div className="space-y-1.5">
                  {wallet.coupons.map((c) => (
                    <div key={c.code} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{c.code}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.title}</div>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">expires {formatDate(c.expiresAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No active coupons right now.</div>
              )}
            </div>

            <div className="rounded-lg border border-dashed p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Gift className="h-3.5 w-3.5 text-[var(--brand)]" /> Referral code
              </div>
              <div className="mt-1 font-mono text-sm">{wallet.referralCode}</div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Share this code — friends get a welcome bonus, you earn points.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ========================================================================= *
 * Main view — branded customer-facing demo of the white-label surfaces
 * ========================================================================= */

export default function PortalView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<PortalResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<PortalResponse>(`/api/public/portal?tenant=${ctx.tenant.slug}`)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((err: Error) => {
        if (!cancelled) toast({ title: "Portal unavailable", description: err.message, variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.tenant.slug, toast]);

  const appointmentsOn = info ? info.modules.appointments : ctx.tenant.settings.modules.appointments;
  const loyaltyOn = info ? info.loyaltyEnabled : ctx.tenant.settings.modules.loyalty;
  const tagline = taglineFor(ctx.tenant.businessCategory);

  return (
    <div className="space-y-4">
      <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
        <Globe className="h-3 w-3 shrink-0" />
        You are viewing the customer-facing experience of {ctx.tenant.slug}.gsclientflow.app — driven by the public APIs with rate limiting +
        captcha
      </Badge>

      {/* Branded hero */}
      <div className="rounded-xl p-6 text-white shadow-sm sm:p-8" style={{ backgroundColor: ctx.tenant.brandColor }}>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20 text-sm font-bold">
            {ctx.tenant.logoText}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight sm:text-xl">{ctx.tenant.name}</h1>
            <p className="text-xs text-white/85 sm:text-sm">{tagline}</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-white/80">You choose which channels we may use.</p>
      </div>

      {loading && !info ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Tabs defaultValue="register">
          <TabsList className="h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
            <TabsTrigger value="register" className="shrink-0 px-3">
              Register
            </TabsTrigger>
            <TabsTrigger value="feedback" className="shrink-0 px-3">
              Feedback
            </TabsTrigger>
            <TabsTrigger value="book" className="shrink-0 px-3">
              Book a visit
            </TabsTrigger>
            {loyaltyOn && (
              <TabsTrigger value="wallet" className="shrink-0 px-3">
                My wallet
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="register" className="pt-2">
            <RegisterTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="feedback" className="pt-2">
            <FeedbackTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="book" className="pt-2">
            <BookTab ctx={ctx} info={info} appointmentsOn={appointmentsOn} />
          </TabsContent>
          {loyaltyOn && (
            <TabsContent value="wallet" className="pt-2">
              <WalletTab ctx={ctx} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
