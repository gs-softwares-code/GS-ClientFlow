import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publicId } from "@/server/lib/ids";
import { parseJson, toJson } from "@/server/lib/json";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { loadCustomerLites, parseRules, matchesRules, type SegmentRule } from "@/server/services/segments";

/**
 * Customer service — every function takes tenantId from the session context
 * (never from client input) and composes writes + outbox events in one
 * transaction (transactional outbox).
 */

export type CustomerListQuery = {
  cursor?: string | null;
  limit?: number;
  search?: string | null;
  segmentId?: string | null;
  tagId?: string | null;
  status?: string | null;
  source?: string | null;
  birthdayWithinDays?: number | null;
  inactiveWithinDays?: number | null;
};

const LIST_SELECT = {
  id: true, publicId: true, name: true, email: true, phone: true,
  birthdayMonth: true, birthdayDay: true, source: true, status: true,
  visitCount: true, totalSpendCents: true, pointsBalance: true,
  lastVisitAt: true, createdAt: true, consents: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.CustomerSelect;
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    return { createdAt: new Date(iso), id };
  } catch {
    return null;
  }
}

export async function listCustomers(tenantId: string, q: CustomerListQuery) {
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);

  const where: Prisma.CustomerWhereInput = { tenantId };
  if (q.status) where.status = q.status;
  if (q.source) where.source = q.source;
  if (q.tagId) where.tags = { some: { tagId: q.tagId } };
  if (q.search) {
    const s = q.search.trim();
    where.OR = [
      { name: { contains: s } },
      { email: { contains: s } },
      { phone: { contains: s } },
      { publicId: { contains: s } },
    ];
  }

  // Segment / computed filters are resolved through the segmentation engine,
  // then combined with the cursor condition (keyset pagination).
  let scopedIds: string[] | null = null;
  if (q.segmentId || q.birthdayWithinDays || q.inactiveWithinDays) {
    const lites = await loadCustomerLites(tenantId);
    scopedIds = lites
      .filter((l) => {
        if (l.status !== "active") return false;
        if (q.segmentId) {
          // resolved below via segment rules
          return true;
        }
        if (q.birthdayWithinDays) {
          if (!l.birthdayMonth) return false;
          const next = nextBirthday(l.birthdayMonth, l.birthdayDay);
          return next !== null && next.daysUntil <= q.birthdayWithinDays && next.daysUntil >= 0;
        }
        if (q.inactiveWithinDays) {
          const days = l.lastVisitAt ? Math.floor((Date.now() - l.lastVisitAt.getTime()) / 86400_000) : 9999;
          return days >= q.inactiveWithinDays;
        }
        return true;
      })
      .map((l) => l.id);
    if (q.segmentId) {
      const segment = await db.segment.findFirst({ where: { id: q.segmentId, tenantId } });
      if (!segment) scopedIds = [];
      else {
        const rules: SegmentRule[] = parseRules(segment.rules);
        scopedIds = lites.filter((l) => l.status === "active" && matchesRules(l, rules)).map((l) => l.id);
      }
    }
    where.id = scopedIds.length ? { in: scopedIds } : { in: ["__none__"] };
  }

  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (cursor) {
    where.AND = [
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await db.customer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: LIST_SELECT,
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore && items.length
    ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
    : null;

  return { items, nextCursor, hasMore };
}

export function nextBirthday(month: number, day: number | null): { date: Date; daysUntil: number; turnsAge: number | null } | null {
  if (!day) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let year = today.getUTCFullYear(); year <= today.getUTCFullYear() + 1; year++) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate >= today) {
      const daysUntil = Math.round((candidate.getTime() - today.getTime()) / 86400_000);
      return { date: candidate, daysUntil, turnsAge: year };
    }
  }
  return null;
}

export async function getCustomer(tenantId: string, customerId: string) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    include: {
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      referralCodes: { take: 1, select: { code: true, usesCount: true } },
    },
  });
  if (!customer) return null;

  const feedbackAgg = await db.feedback.aggregate({
    where: { tenantId, customerId },
    _avg: { rating: true },
    _count: true,
  });

  const lite = (await loadCustomerLites(tenantId, [customerId]))[0];

  const birthday = customer.birthdayMonth && customer.birthdayDay
    ? nextBirthday(customer.birthdayMonth, customer.birthdayDay)
    : null;

  return {
    ...customer,
    consents: parseJson(customer.consents, {}),
    birthday: birthday ? { month: customer.birthdayMonth, day: customer.birthdayDay, daysUntil: birthday.daysUntil } : null,
    clvCents: customer.totalSpendCents,
    feedbackAvg: feedbackAgg._avg.rating ? Math.round(feedbackAgg._avg.rating * 10) / 10 : null,
    feedbackCount: feedbackAgg._count,
    daysSinceLastVisit: lite && lite.lastVisitAt ? Math.floor((Date.now() - lite.lastVisitAt.getTime()) / 86400_000) : null,
    isRepeat: customer.visitCount >= 2,
    isInactive: lite ? (lite.lastVisitAt ? Date.now() - lite.lastVisitAt.getTime() > 45 * 86400_000 : true) : false,
    referralCode: customer.referralCodes[0] ?? null,
  };
}

export type CustomerInput = {
  name: string;
  email: string;
  phone?: string | null;
  birthday?: string | null; // YYYY-MM-DD
  source?: string;
  referredByCode?: string | null;
  consents?: { marketing?: boolean; email?: boolean; sms?: boolean; whatsapp?: boolean };
  notes?: string | null;
};

function parseBirthday(birthday?: string | null): { year: number | null; month: number | null; day: number | null } {
  if (!birthday) return { year: null, month: null, day: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday.trim());
  if (!m) return { year: null, month: null, day: null };
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export async function createCustomer(tenantId: string, input: CustomerInput) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.customer.findFirst({ where: { tenantId, email } });
  if (existing) {
    const err = new Error("A customer with this email already exists") as Error & { code: string };
    err.code = "duplicate";
    throw err;
  }

  const b = parseBirthday(input.birthday);
  let referredBy: { id: string; code: string } | null = null;
  if (input.referredByCode?.trim()) {
    const ref = await db.referralCode.findFirst({ where: { tenantId, code: input.referredByCode.trim().toUpperCase() } });
    referredBy = ref ? { id: ref.customerId, code: ref.code } : null;
  }

  const customer = await db.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        tenantId,
        publicId: publicId(),
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        birthdayYear: b.year,
        birthdayMonth: b.month,
        birthdayDay: b.day,
        source: input.source ?? (referredBy ? "referral" : "walk_in"),
        referredByCode: referredBy?.code ?? null,
        consents: toJson({
          marketing: input.consents?.marketing ?? true,
          email: input.consents?.email ?? true,
          sms: input.consents?.sms ?? false,
          whatsapp: input.consents?.whatsapp ?? false,
        }),
        notes: input.notes?.trim() || null,
      },
    });
    // Transactional outbox: the event is committed with the customer row.
    await publish(tx, {
      tenantId,
      type: EventTypes.CustomerRegistered,
      payload: {
        customerId: created.id,
        publicId: created.publicId,
        name: created.name,
        email: created.email,
        source: created.source,
        referredByCode: referredBy?.code ?? null,
      },
      dedupeKey: `registered:${created.id}`,
    });
    return created;
  });

  return customer;
}

export async function updateCustomer(
  tenantId: string,
  customerId: string,
  patch: Partial<CustomerInput> & { status?: string }
) {
  const b = patch.birthday !== undefined ? parseBirthday(patch.birthday) : null;
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) return null;

  const updated = await db.$transaction(async (tx) => {
    const data: Prisma.CustomerUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.email !== undefined) data.email = patch.email.trim().toLowerCase();
    if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
    if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
    if (patch.status !== undefined) data.status = patch.status;
    if (b) {
      data.birthdayYear = b.year;
      data.birthdayMonth = b.month;
      data.birthdayDay = b.day;
    }
    if (patch.consents !== undefined) {
      data.consents = toJson({ ...parseJson(customer.consents, {}), ...patch.consents });
    }
    const row = await tx.customer.update({ where: { id: customerId }, data });
    await publish(tx, {
      tenantId,
      type: EventTypes.CustomerUpdated,
      payload: { customerId, reason: patch.status === "archived" ? "archived" : "profile_edited" },
    });
    return row;
  });
  return updated;
}

export async function setCustomerTags(tenantId: string, customerId: string, tagIds: string[]) {
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) return null;
  const validTags = await db.tag.findMany({ where: { tenantId, id: { in: tagIds } } });
  await db.$transaction([
    db.customerTag.deleteMany({ where: { customerId } }),
    ...validTags.map((t) => db.customerTag.create({ data: { customerId, tagId: t.id } })),
  ]);
  return validTags;
}

export async function addVisit(
  tenantId: string,
  customerId: string,
  input: { amountCents?: number; note?: string; occurredAt?: string }
) {
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) return null;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

  const visit = await db.$transaction(async (tx) => {
    const created = await tx.visit.create({
      data: {
        tenantId,
        customerId,
        occurredAt,
        amountCents: Math.max(0, Math.round(input.amountCents ?? 0)),
        note: input.note?.trim() || null,
      },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: {
        visitCount: { increment: 1 },
        totalSpendCents: { increment: created.amountCents },
        lastVisitAt: occurredAt,
        firstVisitAt: customer.firstVisitAt ?? occurredAt,
      },
    });
    await publish(tx, {
      tenantId,
      type: EventTypes.CustomerUpdated,
      payload: { customerId, reason: "visit_recorded" },
    });
    return created;
  });
  return visit;
}

export async function customerTimeline(tenantId: string, customerId: string, limit = 60) {
  const [visits, feedback, appointments, messages, rewardTxs, runs] = await Promise.all([
    db.visit.findMany({ where: { tenantId, customerId }, orderBy: { occurredAt: "desc" }, take: 20 }),
    db.feedback.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.appointment.findMany({ where: { tenantId, customerId }, orderBy: { startAt: "desc" }, take: 20 }),
    db.message.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.rewardTransaction.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.workflowRun.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  type Entry = { at: string; type: string; title: string; detail: string; tone?: string };
  const entries: Entry[] = [
    ...visits.map((v) => ({
      at: v.occurredAt.toISOString(),
      type: "visit",
      title: `Visit recorded${v.amountCents ? ` — ₹${(v.amountCents / 100).toLocaleString("en-IN")}` : ""}`,
      detail: v.note ?? "Walk-in visit",
      tone: "visit",
    })),
    ...feedback.map((f) => ({
      at: f.createdAt.toISOString(),
      type: "feedback",
      title: `Feedback: ${"★".repeat(f.rating)} (${f.rating}/5)`,
      detail: f.comment ?? "No comment",
      tone: f.rating <= 3 ? "negative" : "positive",
    })),
    ...appointments.map((a) => ({
      at: a.startAt.toISOString(),
      type: "appointment",
      title: `Appointment ${a.status.replace("_", " ")}`,
      detail: `${a.durationMin} min${a.note ? ` — ${a.note}` : ""}`,
    })),
    ...messages.map((m) => ({
      at: m.createdAt.toISOString(),
      type: "message",
      title: `${m.channel} message (${m.kind}) — ${m.status}`,
      detail: m.subject ? `${m.subject}: ${m.body.slice(0, 80)}` : m.body.slice(0, 100),
      tone: m.status === "failed" ? "negative" : undefined,
    })),
    ...rewardTxs.map((t) => ({
      at: t.createdAt.toISOString(),
      type: "loyalty",
      title: `${t.points >= 0 ? "+" : ""}${t.points} pts — ${t.reason}`,
      detail: `Balance after: ${t.balanceAfter}`,
    })),
    ...runs.map((r) => ({
      at: r.createdAt.toISOString(),
      type: "workflow",
      title: `Workflow run — ${r.status}`,
      detail: parseJson<{ steps?: { step: string; detail?: string }[] }>(r.steps, {}).steps?.map((s) => s.step).join(" → ") ?? "",
    })),
  ];

  entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  return entries.slice(0, limit);
}
