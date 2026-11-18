import type { Prisma, Tenant, Workflow } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJson, toJson } from "@/server/lib/json";
import { sendChannelMessage, renderTemplate } from "@/server/channels/adapter";
import { loadCustomerLites, matchesRules, parseRules, resolveAudienceIds } from "@/server/services/segments";
import type { EventType } from "@/server/events/contracts";
import { logEvent } from "@/server/logs";

/**
 * Configurable workflow engine.
 *
 * A workflow = trigger (event | date | manual) + conditions (attribute rules
 * and/or segment audience) + optional time delay + channel + template +
 * consent requirement. Every execution writes a WorkflowRun "execution log".
 */

export type WorkflowWithTenant = Workflow & { tenant: Tenant };
type WorkflowRow = Workflow;

export type TriggerInfo = {
  seed: string; // dedupe seed for this trigger occurrence (year, month, event id)
  source: string; // human-readable trigger origin
  feedbackRating?: number;
};

export async function dispatchEventWorkflows(
  tenantId: string,
  eventType: EventType | string,
  customer: { id: string } | null,
  triggerInfo: TriggerInfo
): Promise<{ matched: number; executed: number; skipped: number }> {
  const workflows = await db.workflow.findMany({
    where: { tenantId, active: true, triggerType: "event", triggerEvent: eventType },
  });
  let executed = 0, skipped = 0;
  for (const wf of workflows) {
    if (!customer) continue;
    const result = await executeWorkflowForCustomer(wf, customer.id, triggerInfo);
    if (result === "completed") executed += 1;
    else if (result === "skipped") skipped += 1;
  }
  return { matched: workflows.length, executed, skipped };
}

export async function executeWorkflowForCustomer(
  workflow: WorkflowRow,
  customerId: string,
  triggerInfo: TriggerInfo
): Promise<"completed" | "skipped" | "failed" | "scheduled" | "not_found"> {
  const tenant = await db.tenant.findUnique({ where: { id: workflow.tenantId } });
  if (!tenant) return "not_found";
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: workflow.tenantId },
    select: { id: true, name: true, email: true, phone: true, consents: true, pointsBalance: true, status: true },
  });
  if (!customer || customer.status !== "active") return "not_found";

  const steps: { step: string; detail: string; ok: boolean }[] = [];

  // 1. Attribute conditions (plus optional segment membership)
  const rules = parseRules(workflow.conditionRules);
  if (rules.length > 0) {
    const lites = await loadCustomerLites(workflow.tenantId, [customerId]);
    const lite = lites[0];
    const pass = lite ? matchesRules(lite, rules, { feedbackRating: triggerInfo.feedbackRating }) : false;
    steps.push({ step: "conditions", detail: rules.length + " rule(s)", ok: pass });
    if (!pass) {
      await recordRun(workflow, customerId, "skipped", triggerInfo, steps);
      return "skipped";
    }
  }
  if (workflow.segmentId) {
    const audience = await resolveAudienceIds(workflow.tenantId, { segmentId: workflow.segmentId });
    const inSegment = audience.includes(customerId);
    steps.push({ step: "audience", detail: "segment membership", ok: inSegment });
    if (!inSegment) {
      await recordRun(workflow, customerId, "skipped", triggerInfo, steps);
      return "skipped";
    }
  }

  // 2. Time delay — schedule the send instead of executing now.
  if (workflow.offsetMinutes && workflow.offsetMinutes > 0) {
    const dueAt = new Date(Date.now() + workflow.offsetMinutes * 60_000);
    const dedupe = `wfstep:${workflow.id}:${customerId}:${triggerInfo.seed}`;
    const existing = await db.scheduledAction.findFirst({ where: { tenantId: workflow.tenantId, kind: "workflow_step", status: "pending", payload: toJson({ workflowId: workflow.id, customerId, seed: triggerInfo.seed }) } });
    if (!existing) {
      await db.scheduledAction.create({
        data: {
          tenantId: workflow.tenantId,
          kind: "workflow_step",
          payload: toJson({ workflowId: workflow.id, customerId, seed: triggerInfo.seed }),
          dueAt,
        },
      });
    }
    steps.push({ step: "delay", detail: `scheduled in ${workflow.offsetMinutes} min (due ${dueAt.toISOString()})`, ok: true });
    await recordRun(workflow, customerId, "scheduled", triggerInfo, steps);
    return "scheduled";
  }

  return sendWorkflowMessage(workflow, tenant, customer, triggerInfo, steps);
}

export async function sendWorkflowMessage(
  workflow: WorkflowRow,
  tenant: Tenant,
  customer: { id: string; name: string; email: string; phone: string | null; consents: string; pointsBalance: number },
  triggerInfo: TriggerInfo,
  steps: { step: string; detail: string; ok: boolean }[]
): Promise<"completed" | "skipped" | "failed"> {
  // 3. Consent verification
  const consents = parseJson<Record<string, boolean>>(customer.consents, {});
  const channel = (workflow.channel as "email" | "sms" | "whatsapp") ?? "email";
  const hasConsent = channel === "email" ? consents.email !== false : consents[channel] === true;
  if (workflow.requireConsent && !hasConsent) {
    steps.push({ step: "consent", detail: `no consent for ${channel}`, ok: false });
    await recordRun(workflow, customer.id, "skipped", triggerInfo, steps);
    return "skipped";
  }
  steps.push({ step: "consent", detail: `${channel} consent ok`, ok: true });

  // 4. Render + send (idempotent per workflow:customer:seed)
  const body = renderTemplate(workflow.template, {
    name: customer.name.split(" ")[0],
    full_name: customer.name,
    business: tenant.name,
    points: customer.pointsBalance,
  });
  try {
    const result = await sendChannelMessage({
      tenant,
      customer,
      channel,
      kind: "workflow",
      subject: workflow.name,
      body,
      idempotencyKey: `wf:${workflow.id}:${customer.id}:${triggerInfo.seed}`,
      requireConsent: workflow.requireConsent,
    });
    steps.push({ step: "send", detail: `${channel} -> ${result.status}: ${result.detail}`, ok: result.status !== "failed" && result.status !== "skipped" });
    const status = result.status === "skipped" ? "skipped" : result.status === "failed" ? "failed" : "completed";
    await recordRun(workflow, customer.id, status, triggerInfo, steps);
    return status;
  } catch (err) {
    steps.push({ step: "send", detail: `error: ${err instanceof Error ? err.message : String(err)}`, ok: false });
    await recordRun(workflow, customer.id, "failed", triggerInfo, steps);
    return "failed";
  }
}

export async function recordRun(
  workflow: WorkflowRow,
  customerId: string | null,
  status: string,
  triggerInfo: TriggerInfo,
  steps: { step: string; detail: string; ok: boolean }[]
) {
  await db.workflowRun.create({
    data: {
      tenantId: workflow.tenantId,
      workflowId: workflow.id,
      customerId,
      triggerInfo: toJson({ ...triggerInfo, workflowName: workflow.name }),
      status,
      steps: toJson(steps),
    },
  });
  await db.workflow.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } }).catch(() => undefined);
}

/** Manual / audience run (staff-triggered or date-scan bulk execution). */
export async function runWorkflowForAudience(workflowId: string, onlyCustomerId?: string | null) {
  const workflow = await db.workflow.findUnique({ where: { id: workflowId }, include: { tenant: true } });
  if (!workflow) return { executed: 0, skipped: 0, failed: 0, scheduled: 0, notFound: true } as const;
  const audience = onlyCustomerId ? [onlyCustomerId] : await resolveAudienceIds(workflow.tenantId, { segmentId: workflow.segmentId, rules: parseRules(workflow.conditionRules) });
  let executed = 0, skipped = 0, failed = 0, scheduled = 0;
  const seed = `manual:${Date.now()}`;
  for (const customerId of audience.slice(0, 200)) {
    const outcome = await executeWorkflowForCustomer(workflow, customerId, { seed, source: "manual run" });
    if (outcome === "completed") executed += 1;
    else if (outcome === "skipped") skipped += 1;
    else if (outcome === "failed") failed += 1;
    else if (outcome === "scheduled") scheduled += 1;
  }
  await logEvent("info", "workflow", `Manual run "${workflow.name}": ${executed} sent, ${skipped} skipped`, { workflowId }, workflow.tenantId);
  return { executed, skipped, failed, scheduled, notFound: false };
}

export async function workflowPresetDefinitions() {
  // used by seed + UI preset picker
  return [
    { category: "birthday", name: "Birthday wishes", dateKind: "birthday", channel: "email", template: "Hi {name}, a little bird told us your birthday is coming up! From all of us at {business} — have a wonderful day. Show this message for a small birthday treat.", description: "Runs N days before each customer's birthday (yearly)." },
    { category: "onboarding", name: "Welcome new customers", triggerEvent: "customer.registered", channel: "email", offsetMinutes: 60, template: "Welcome to {business}, {name}! We are thrilled to have you. Your first visit earns loyalty points automatically — reply anytime if you need anything.", description: "Sends a welcome message 1 hour after registration." },
    { category: "inactive", name: "Win back inactive customers", dateKind: "inactive", channel: "email", template: "Hi {name}, we have missed you at {business}! It has been a while — come back this month and enjoy a little something from us.", description: "Monthly reminder after 45+ days without a visit." },
    { category: "appointment_reminder", name: "Appointment reminders", dateKind: "appointment_reminder", channel: "sms", template: "Reminder: your appointment at {business} is tomorrow. Reply to reschedule if needed.", description: "24h reminder before each appointment." },
    { category: "feedback_followup", name: "Low rating follow-up", triggerEvent: "feedback.submitted", channel: "email", conditionRules: [{ attr: "feedbackRating", op: "lte", value: 3 }], template: "Hi {name}, thank you for your honest feedback at {business}. We would love to make it right — can we call you this week?", description: "Apology outreach when a rating is 3 stars or lower." },
    { category: "offer_expiry", name: "Offer expiry nudges", dateKind: "offer_expiry", channel: "email", template: "Hi {name}, your offer at {business} is about to expire — do not let it slip away!", description: "Reminder 3 days before an offer/coupon expires." },
  ] as const;
}
