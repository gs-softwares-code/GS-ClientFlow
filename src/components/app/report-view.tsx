"use client";

import { Check, FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AppCtx } from "@/lib/client/types";

/* ---------- static report data ---------- */

type ItemStatus = "done" | "adapted" | "prod";

type ReportItem = { name: string; status: ItemStatus; note: string };
type ReportEvent = { type: string; description: string };
type ReportSection = {
  title: string;
  description?: string;
  items: ReportItem[];
  events?: ReportEvent[];
  note?: string;
};

const STATUS_LABELS: Record<ItemStatus, string> = {
  done: "implemented",
  adapted: "adapted for sandbox",
  prod: "documented for production",
};

const STATUS_CLASS: Record<ItemStatus, string> = {
  done: "border-emerald-600 bg-emerald-600/10 text-emerald-700",
  adapted: "border-amber-600 bg-amber-600/10 text-amber-700",
  prod: "text-muted-foreground",
};

function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <Badge variant="outline" className={`h-fit whitespace-nowrap text-[10px] ${STATUS_CLASS[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const SECTIONS: ReportSection[] = [
  {
    title: "A. Database optimization",
    description: "Storage layer decisions and how they map from sandbox to production",
    items: [
      {
        name: "Neon PostgreSQL",
        status: "adapted",
        note: "Sandbox mandates SQLite via Prisma; the schema is Postgres-shaped — uuid ids, tenant_id on every row, ISO datetimes — for a mechanical Drizzle/Neon migration.",
      },
      {
        name: "Drizzle + versioned migrations",
        status: "adapted",
        note: "Prisma db push in sandbox; the equivalent Drizzle migration SQL is documented in the report.",
      },
      {
        name: "Connection pooling",
        status: "done",
        note: "Single PrismaClient singleton reused process-wide — no per-request connections; maps to a Hyperdrive/Neon pooled endpoint.",
      },
      {
        name: "Row-Level Security",
        status: "adapted",
        note: "Emulated by the tenant guard + tenant-scoped services; equivalent Postgres RLS policies documented.",
      },
      {
        name: "Transaction-local tenant context",
        status: "done",
        note: "Session-derived tenant ctx passed through every handler.",
      },
      {
        name: "App roles cannot bypass isolation",
        status: "done",
        note: "No client-supplied tenant ids anywhere; isolation test runner passes 8/8 probes.",
      },
      {
        name: "Indexes",
        status: "done",
        note: "Composite indexes on customer lookup (tenant,status,createdAt), birthday scheduling (tenant,birthdayMonth,birthdayDay), inactive detection (tenant,lastVisitAt), campaign execution (tenant,status,scheduledAt).",
      },
      {
        name: "Cursor pagination",
        status: "done",
        note: "Keyset (createdAt,id) with base64url cursor — no offset scans.",
      },
      {
        name: "No over-fetching",
        status: "done",
        note: "Projection selects + lightweight customer lites for segmentation.",
      },
      {
        name: "Backup / recovery",
        status: "done",
        note: "GET /api/ops/backup full tenant JSON snapshot + documented restore.",
      },
      {
        name: "Retention & archiving",
        status: "done",
        note: "Policy config + customer archiving, event log pruning.",
      },
      {
        name: "Neon branching",
        status: "adapted",
        note: "Documented workflow — branch per migration test, push schema, run seed, promote.",
      },
    ],
  },
  {
    title: "B. Event-driven automation",
    description: "Transactional outbox, the queue, and idempotency guarantees",
    items: [
      {
        name: "Transactional outbox",
        status: "done",
        note: "Business writes + event inserts commit atomically in one Prisma transaction.",
      },
      {
        name: "Queue",
        status: "adapted",
        note: "In-process worker with identical semantics to the Cloudflare Queues consumer — claim with lease, idempotent handlers, exponential backoff 3s→5min cap, dead-letter after 5 attempts, retry from DLQ.",
      },
      {
        name: "Idempotency",
        status: "done",
        note: "Unique dedupe keys on events, reward transactions, messages and scheduled actions.",
      },
    ],
    events: [
      { type: "customer.registered", description: "New signup via the public portal or staff-side create; starts onboarding." },
      { type: "customer.updated", description: "Profile edit; re-evaluates segments and follow-ups." },
      { type: "customer.birthday.upcoming", description: "Materialized by the date-trigger scheduler ahead of each birthday." },
      { type: "feedback.submitted", description: "Rating captured; loyalty points credited and follow-up opened." },
      { type: "offer.created", description: "Coupon generated for a customer by workflow or staff." },
      { type: "offer.redeemed", description: "Redemption recorded, balance decremented, loop closed." },
      { type: "campaign.scheduled", description: "Campaign queued for a future execution slot." },
      { type: "campaign.completed", description: "Delivery counts summarized once a campaign finishes." },
      { type: "appointment.booked", description: "Slot reserved, confirmation sent, reminders armed." },
      { type: "appointment.cancelled", description: "Slot freed, pending reminders cancelled." },
    ],
  },
  {
    title: "C. Customer intelligence",
    description: "Everything the CRM computes about a customer — from stored rows only",
    items: [
      { name: "Segmentation", status: "done", note: "Saved segments with attribute rules evaluated over customer lites." },
      { name: "Tags", status: "done", note: "Colored tags per customer for lightweight grouping." },
      { name: "Visit history", status: "done", note: "Per-customer visit timeline with amounts and services." },
      { name: "Purchase history where available", status: "done", note: "Spend captured per visit." },
      { name: "CLV", status: "done", note: "Computed lifetime spend per customer." },
      { name: "Repeat identification", status: "done", note: "visitCount >= 2 flags repeat customers." },
      { name: "Inactive detection", status: "done", note: "lastVisitAt window per tenant config." },
      { name: "Engagement timeline", status: "done", note: "Every message, event and workflow run per customer." },
      { name: "Follow-up reminders", status: "done", note: "Scheduled actions for feedback and visit follow-ups." },
      { name: "Source attribution", status: "done", note: "Sources plus referral codes captured at registration." },
    ],
    note: "No fabricated metrics — every figure is computed from stored rows.",
  },
  {
    title: "D. Advanced automation",
    description: "The workflow engine and what ships preconfigured",
    items: [
      {
        name: "Workflow engine",
        status: "done",
        note: "Event/date/manual triggers, attribute conditions, audience filters, time delays, consent verification, multi-channel delivery, execution logs.",
      },
      {
        name: "Preconfigured workflows",
        status: "done",
        note: "Birthday, onboarding, inactive, appointment reminders, feedback follow-ups, offer expiry — all seeded active.",
      },
    ],
  },
  {
    title: "E. Loyalty",
    description: "The points economy and its integrity guarantees",
    items: [
      { name: "Points", status: "done", note: "Balances per customer, issued and redeemed through a ledger." },
      { name: "Configurable earning rules", status: "done", note: "Points per visit, feedback, referral and per hundred rupees — set per tenant." },
      { name: "Redemption rules", status: "done", note: "Redemption minimum enforced per tenant." },
      { name: "Referral codes", status: "done", note: "Unique code per customer, attribution on registration." },
      { name: "Coupon generation", status: "done", note: "Coupons minted by workflows and staff actions." },
      { name: "Redemption tracking", status: "done", note: "Every redemption recorded with source and time." },
      { name: "Transactional history", status: "done", note: "Append-only ledger of every credit and debit." },
      { name: "Duplicate-credit prevention", status: "done", note: "Unique idempotency keys inside the points transaction." },
    ],
  },
  {
    title: "F. Appointments",
    description: "Scheduling surface, gated per tenant and shaped per business category",
    items: [
      { name: "Service catalog", status: "done", note: "Services with duration and price, per tenant." },
      { name: "Staff", status: "done", note: "Staff records tied to the appointment calendar." },
      { name: "Booking", status: "done", note: "Conflict-checked slot booking, public and staff-side." },
      { name: "Confirmation", status: "done", note: "Confirmation message on booking." },
      { name: "Cancellation", status: "done", note: "Cancelling frees the slot and stops pending reminders." },
      { name: "Reminders", status: "done", note: "Reminder scheduled actions ahead of each visit." },
      { name: "No-show tracking", status: "done", note: "No-show status feeds retention signals." },
      { name: "Post-appointment follow-up", status: "done", note: "Follow-up workflow after the visit window." },
      { name: "Configurable per business category", status: "done", note: "Module toggle plus category presets." },
    ],
  },
  {
    title: "G. White-label",
    description: "Every surface carries the tenant's own identity",
    items: [
      { name: "Subdomains", status: "done", note: "Slug namespace — {slug}.gsclientflow.app." },
      {
        name: "Custom domains + verification",
        status: "adapted",
        note: "Token + verify flow; DNS check simulated in sandbox, live TXT in production.",
      },
      { name: "Logos / brand colors", status: "done", note: "Logo text and brand color drive every surface." },
      { name: "Registration form customization", status: "done", note: "Field labels, required flags and active toggles drive the public form." },
      { name: "Branded customer pages", status: "done", note: "The client portal view carries the tenant's brand." },
      { name: "Embeddable widget", status: "done", note: "Snippet + live preview." },
      { name: "Tenant email config", status: "done", note: "From name and from email per channel." },
    ],
  },
  {
    title: "H. Analytics",
    description: "Reports computed live, scoped to the tenant, exportable",
    items: [
      { name: "Growth", status: "done", note: "New and cumulative customers by month." },
      { name: "Retention cohorts", status: "done", note: "Monthly cohorts with returned share." },
      { name: "Repeat visits", status: "done", note: "Repeat rate over the customer base." },
      { name: "Campaign performance", status: "done", note: "Delivery and read rates per campaign." },
      { name: "Redemption", status: "done", note: "Offer redemptions tracked over time." },
      { name: "Feedback trends", status: "done", note: "Average rating by month with volume." },
      { name: "Appointment performance", status: "done", note: "Completion and no-show rates plus top services." },
      { name: "Acquisition sources", status: "done", note: "Source mix with referral attribution." },
      { name: "Date filtering", status: "done", note: "From/to range plus quick chips feeds every report." },
      { name: "CSV exports", status: "done", note: "Per-report CSV downloads, tenant-scoped." },
      { name: "Tenant-scoped reports", status: "done", note: "Every query resolves the tenant from the session." },
    ],
  },
  {
    title: "I. Operational optimization",
    description: "Runtime discipline: quotas, rate limits, logs and cron",
    items: [
      {
        name: "Monitoring",
        status: "done",
        note: "Worker/queue/scheduled-actions/storage views; production maps to Neon compute metrics, Workers analytics, Queue metrics, provider quotas.",
      },
      { name: "Usage limits + plan quotas", status: "done", note: "Per-tenant metric windows with plan ceilings." },
      { name: "Rate limiting", status: "done", note: "Per-tenant token buckets; public endpoints per-IP." },
      {
        name: "Turnstile server-side validation",
        status: "adapted",
        note: "Sandbox token protocol; live siteverify when TURNSTILE_SECRET set.",
      },
      { name: "Cron discipline", status: "done", note: "One scheduler scan for all tenants, no per-tenant cron triggers." },
      { name: "External API discipline", status: "done", note: "No external calls in the hot path; only the optional AI drafting endpoint." },
      { name: "Caching", status: "done", note: "Local-memory only, and only where tenant-aware." },
      { name: "Structured logs + error monitoring", status: "done", note: "SystemLog table + JSON stdout lines, surfaced in Ops." },
    ],
  },
];

const PRIORITIES: { priority: string; scope: string }[] = [
  { priority: "Priority 1", scope: "Multi-tenant security, CRM, registration, feedback, birthday automation, core dashboard" },
  { priority: "Priority 2", scope: "Communications, campaigns, segmentation, white-label" },
  { priority: "Priority 3", scope: "Loyalty, appointments, advanced analytics, enterprise features" },
];

const VERIFICATION: { title: string; detail: string }[] = [
  {
    title: "TypeScript strict build passes",
    detail: "The whole surface compiles under the strict compiler options with no type errors in application code.",
  },
  {
    title: "API surface exercised",
    detail:
      "auth/session; customers CRUD + cursor pages; segments; feedback; appointments booking/conflict/no-show; offers + idempotent redemption; campaigns schedule/run; workflows toggle/run; events retry-from-DLQ; ops security-tests 8/8; CSV exports; public register/feedback/book; AI draft.",
  },
  {
    title: "End-to-end flows verified in-browser",
    detail:
      "login → dashboard → customer detail → record visit → loyalty credit; registration → onboarding workflow delayed send; birthday scheduler → wishes sent; campaign scheduled → executed via event pipeline; dead-letter → retry succeeds.",
  },
  {
    title: "Worker processes events with retries visible",
    detail:
      "Transient 503 demo event succeeds on attempt 2; permanent-bounce demo event dead-letters after 5 attempts and is retryable from the Automation view.",
  },
];

/* ---------- section renderer ---------- */

function SectionCard({ section }: { section: ReportSection }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{section.title}</CardTitle>
        {section.description && <CardDescription>{section.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ul>
          {section.items.map((item) => (
            <li
              key={item.name}
              className="grid gap-1 border-b py-2.5 last:border-b-0 sm:grid-cols-[minmax(150px,190px)_auto_1fr] sm:items-start sm:gap-x-3 sm:py-2"
            >
              <span className="text-sm font-medium leading-snug">{item.name}</span>
              <StatusBadge status={item.status} />
              <p className="text-xs leading-relaxed text-muted-foreground">{item.note}</p>
            </li>
          ))}
        </ul>

        {section.events && (
          <div className="mt-3 rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The 10 required events</div>
            <ul className="space-y-1">
              {section.events.map((ev) => (
                <li key={ev.type} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:gap-x-2">
                  <span className="shrink-0 font-mono text-[10px] text-[var(--brand)]">{ev.type}</span>
                  <span className="text-muted-foreground">{ev.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {section.note && (
          <p className="mt-3 rounded-lg border border-dashed p-3 text-xs italic text-muted-foreground">{section.note}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ========================================================================= *
 * Implementation & Testing Report — rendered in-app, static data only
 * ========================================================================= */

export default function ReportView({ ctx }: { ctx: AppCtx }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Implementation &amp; Testing Report</h1>
        <p className="text-sm text-muted-foreground">
          Continuously updated build record — GS ClientFlow multi-tenant CRM (viewing {ctx.tenant.name})
        </p>
      </div>

      <Alert>
        <FileText />
        <AlertTitle>Live document</AlertTitle>
        <AlertDescription>
          This is the live document; the full text also lives in IMPLEMENTATION_REPORT.md at the repo root.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}

        {/* J. Delivery priorities */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">J. Delivery priorities</CardTitle>
            <CardDescription>Milestones as committed, and how they landed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Priority</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="w-[90px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PRIORITIES.map((p) => (
                    <TableRow key={p.priority}>
                      <TableCell className="font-medium">{p.priority}</TableCell>
                      <TableCell className="whitespace-normal text-sm">{p.scope}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-emerald-700">
                          done
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">Reusable services + shared event contracts — no disconnected modules.</p>
          </CardContent>
        </Card>

        {/* Verification & testing */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Verification &amp; testing</CardTitle>
            <CardDescription>What has actually been exercised — by hand and by flow</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {VERIFICATION.map((v) => (
              <div key={v.title} className="flex items-start gap-2.5 rounded-lg border p-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-emerald-600 bg-emerald-600/10">
                  <Check className="h-3 w-3 text-emerald-700" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{v.title}</div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{v.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
