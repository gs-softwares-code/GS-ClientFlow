import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * GS ClientFlow — Production Drizzle PostgreSQL Schema
 * Configured for Neon PostgreSQL with Connection Pooling, RLS, and Versioned Migrations.
 *
 * Maps 1:1 with prisma/schema.prisma models for zero-divergence compatibility.
 */

// ---------------------------------------------------------------- tenancy

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    businessCategory: text("business_category").notNull().default("services"),
    verticalType: text("vertical_type").notNull().default("GENERAL"),
    customDomain: text("custom_domain").unique(),
    domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
    domainVerifyToken: text("domain_verify_token"),
    brandColor: text("brand_color").notNull().default("#0f766e"),
    logoText: text("logo_text").notNull().default("GC"),
    plan: text("plan").notNull().default("starter"),
    status: text("status").notNull().default("active"),
    timezone: text("timezone").notNull().default("Asia/Calcutta"),
    settings: text("settings").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tenants_status_idx").on(table.status),
  ]
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("staff"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_tenant_email_idx").on(table.tenantId, table.email),
    index("users_email_idx").on(table.email),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_expires_at_idx").on(table.expiresAt),
  ]
);

// ---------------------------------------------------------------- customers

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    birthdayYear: integer("birthday_year"),
    birthdayMonth: integer("birthday_month"),
    birthdayDay: integer("birthday_day"),
    source: text("source").notNull().default("walk_in"),
    referredByCode: text("referred_by_code"),
    status: text("status").notNull().default("active"),
    consents: text("consents").notNull().default("{}"),
    preferences: text("preferences").notNull().default("{}"),
    notes: text("notes"),
    firstVisitAt: timestamp("first_visit_at", { withTimezone: true }),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    visitCount: integer("visit_count").notNull().default(0),
    totalSpendCents: integer("total_spend_cents").notNull().default(0),
    pointsBalance: integer("points_balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_tenant_public_id_idx").on(table.tenantId, table.publicId),
    uniqueIndex("customers_tenant_email_idx").on(table.tenantId, table.email),
    index("customers_lookup_idx").on(table.tenantId, table.status, table.createdAt),
    index("customers_birthday_idx").on(table.tenantId, table.birthdayMonth, table.birthdayDay),
    index("customers_inactive_idx").on(table.tenantId, table.lastVisitAt),
    index("customers_source_idx").on(table.tenantId, table.source),
    index("customers_points_idx").on(table.tenantId, table.pointsBalance),
  ]
);

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#0f766e"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tags_tenant_name_idx").on(table.tenantId, table.name),
  ]
);

export const customerTags = pgTable(
  "customer_tags",
  {
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.customerId, table.tagId] }),
    index("customer_tags_tag_id_idx").on(table.tagId),
  ]
);

export const visits = pgTable(
  "visits",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    amountCents: integer("amount_cents").notNull().default(0),
    staffId: text("staff_id"),
    note: text("note"),
  },
  (table) => [
    index("visits_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
    index("visits_customer_occurred_idx").on(table.customerId, table.occurredAt),
  ]
);

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    status: text("status").notNull().default("new"),
    followUpStatus: text("follow_up_status").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("feedback_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("feedback_tenant_rating_idx").on(table.tenantId, table.rating),
    index("feedback_customer_idx").on(table.customerId),
  ]
);

export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    rules: text("rules").notNull().default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("segments_tenant_idx").on(table.tenantId),
  ]
);

// ---------------------------------------------------------------- appointments

export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    priceCents: integer("price_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("services_tenant_name_idx").on(table.tenantId, table.name),
    index("services_tenant_active_idx").on(table.tenantId, table.active),
  ]
);

export const staff = pgTable(
  "staff",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    availability: text("availability").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_tenant_active_idx").on(table.tenantId, table.active),
  ]
);

export const appointments = pgTable(
  "appointments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    assignedStaffId: text("assigned_staff_id"),
    preferences: text("preferences").notNull().default("{}"),
    checkInStatus: text("check_in_status").notNull().default("SCHEDULED"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    reminder24hSentAt: timestamp("reminder_24h_sent_at", { withTimezone: true }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    status: text("status").notNull().default("scheduled"),
    note: text("note"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("appointments_calendar_idx").on(table.tenantId, table.startAt),
    index("appointments_status_idx").on(table.tenantId, table.status, table.startAt),
    index("appointments_customer_idx").on(table.customerId, table.startAt),
  ]
);

// ---------------------------------------------------------------- offers / loyalty

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    kind: text("kind").notNull().default("discount"),
    value: integer("value").notNull().default(0),
    channel: text("channel").notNull().default("email"),
    segmentId: text("segment_id"),
    status: text("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("offers_status_idx").on(table.tenantId, table.status),
    index("offers_expires_at_idx").on(table.tenantId, table.expiresAt),
  ]
);

export const coupons = pgTable(
  "coupons",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    offerId: text("offerId").references(() => offers.id, { onDelete: "set null" }),
    customerId: text("customerId").references(() => customers.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    status: text("status").notNull().default("active"),
    pointsCost: integer("points_cost"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("coupons_tenant_code_idx").on(table.tenantId, table.code),
    index("coupons_tenant_status_idx").on(table.tenantId, table.status),
  ]
);

export const offerRedemptions = pgTable(
  "offer_redemptions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    couponId: text("coupon_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("offer_redemptions_offer_customer_idx").on(table.offerId, table.customerId),
    index("offer_redemptions_tenant_created_idx").on(table.tenantId, table.createdAt),
  ]
);

export const rewardTransactions = pgTable(
  "reward_transactions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reward_txs_history_idx").on(table.tenantId, table.customerId, table.createdAt),
  ]
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    usesCount: integer("uses_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("referral_codes_tenant_code_idx").on(table.tenantId, table.code),
    index("referral_codes_customer_idx").on(table.tenantId, table.customerId),
  ]
);

// ---------------------------------------------------------------- campaigns / messaging

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("email"),
    template: text("template").notNull(),
    segmentId: text("segment_id"),
    filter: text("filter").notNull().default("{}"),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("campaigns_due_scan_idx").on(table.tenantId, table.status, table.scheduledAt),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    kind: text("kind").notNull().default("campaign"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_customer_history_idx").on(table.tenantId, table.customerId, table.createdAt),
    index("messages_campaign_status_idx").on(table.campaignId, table.status),
    index("messages_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ]
);

// ---------------------------------------------------------------- automation & workflows

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull().default("custom"),
    triggerType: text("trigger_type").notNull().default("event"),
    triggerEvent: text("trigger_event"),
    dateKind: text("date_kind"),
    offsetMinutes: integer("offset_minutes"),
    conditionRules: text("condition_rules").notNull().default("[]"),
    segmentId: text("segment_id"),
    channel: text("channel").notNull().default("email"),
    template: text("template").notNull(),
    requireConsent: boolean("require_consent").notNull().default(true),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflows_dispatch_idx").on(table.tenantId, table.active, table.triggerType),
    index("workflows_category_idx").on(table.tenantId, table.category),
  ]
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    triggerInfo: text("trigger_info").notNull().default("{}"),
    status: text("status").notNull().default("completed"),
    steps: text("steps").notNull().default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflow_runs_workflow_idx").on(table.workflowId, table.createdAt),
    index("workflow_runs_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

// ---------------------------------------------------------------- outbox / scheduling / ops

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload").notNull().default("{}"),
    dedupeKey: text("dedupe_key").unique(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_claim_scan_idx").on(table.status, table.availableAt),
    index("outbox_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ]
);

export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: text("payload").notNull().default("{}"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scheduled_actions_due_idx").on(table.status, table.dueAt),
    index("scheduled_actions_tenant_idx").on(table.tenantId, table.status),
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    meta: text("meta").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

export const systemLogs = pgTable(
  "system_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    level: text("level").notNull().default("info"),
    scope: text("scope").notNull(),
    message: text("message").notNull(),
    meta: text("meta").notNull().default("{}"),
    tenantId: text("tenant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("system_logs_created_idx").on(table.createdAt),
  ]
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("usage_counters_tenant_metric_day_idx").on(table.tenantId, table.metric, table.day),
  ]
);

// ---------------------------------------------------------------- vertical automations

export const staffMembers = pgTable(
  "staff_members",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull().default("staff"),
    phone: text("phone"),
    specialties: text("specialties").notNull().default("[]"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_members_tenant_active_idx").on(table.tenantId, table.isActive),
    index("staff_members_role_idx").on(table.tenantId, table.role),
  ]
);

export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    batchOrClass: text("batch_or_class").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull().default("PRESENT"), // PRESENT | ABSENT | LATE | ON_LEAVE
    guardianPhone: text("guardian_phone").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    guardianReplyStatus: text("guardian_reply_status").notNull().default("PENDING"), // PENDING | ACKNOWLEDGED_LEAVE | ACKNOWLEDGED_LATE | NO_REPLY
    guardianReplyText: text("guardian_reply_text"),
    followUpTaskId: text("follow_up_task_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attendance_logs_tenant_date_idx").on(table.tenantId, table.date),
    index("attendance_logs_batch_date_idx").on(table.tenantId, table.batchOrClass, table.date),
    index("attendance_logs_customer_idx").on(table.customerId, table.date),
    index("attendance_logs_reply_status_idx").on(table.tenantId, table.guardianReplyStatus),
  ]
);

export const staffFollowUpTasks = pgTable(
  "staff_follow_up_tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    taskType: text("task_type").notNull().default("ATTENDANCE_CALL"), // ATTENDANCE_CALL | GYM_RENEWAL_CALL | GENERAL
    status: text("status").notNull().default("OPEN"), // OPEN | IN_PROGRESS | RESOLVED
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_follow_up_tasks_tenant_status_idx").on(table.tenantId, table.status, table.dueAt),
    index("staff_follow_up_tasks_customer_idx").on(table.customerId),
  ]
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    planName: text("plan_name").notNull(),
    priceAmount: integer("price_amount").notNull().default(0),
    startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
    expiryDate: timestamp("expiry_date", { withTimezone: true }).notNull(),
    paymentStatus: text("payment_status").notNull().default("PENDING"), // PAID | PENDING | OVERDUE
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | EXPIRING_SOON | EXPIRED | CANCELLED
    lastReminderSentAt: timestamp("last_reminder_sent_at", { withTimezone: true }),
    autoSyncSheetRowId: text("auto_sync_sheet_row_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("memberships_tenant_status_idx").on(table.tenantId, table.status, table.expiryDate),
    index("memberships_customer_idx").on(table.customerId),
    index("memberships_payment_status_idx").on(table.tenantId, table.paymentStatus),
  ]
);
