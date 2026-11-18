-- GS ClientFlow: Initial Production Migration for Neon PostgreSQL
-- Version: 0000_init_neon_rls.sql
-- Targets: Neon PostgreSQL with Row-Level Security, Hyperdrive connection pooling, and composite indexes.

-- 1. Create Core Tables

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "business_category" text NOT NULL DEFAULT 'services',
  "custom_domain" text UNIQUE,
  "domain_verified_at" timestamptz,
  "domain_verify_token" text,
  "brand_color" text NOT NULL DEFAULT '#0f766e',
  "logo_text" text NOT NULL DEFAULT 'GC',
  "plan" text NOT NULL DEFAULT 'starter',
  "status" text NOT NULL DEFAULT 'active',
  "timezone" text NOT NULL DEFAULT 'Asia/Calcutta',
  "settings" text NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants" ("status");

CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'staff',
  "is_platform_admin" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_email_idx" ON "users" ("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "customers" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "public_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "birthday_year" integer,
  "birthday_month" integer,
  "birthday_day" integer,
  "source" text NOT NULL DEFAULT 'walk_in',
  "referred_by_code" text,
  "status" text NOT NULL DEFAULT 'active',
  "consents" text NOT NULL DEFAULT '{}',
  "preferences" text NOT NULL DEFAULT '{}',
  "notes" text,
  "first_visit_at" timestamptz,
  "last_visit_at" timestamptz,
  "visit_count" integer NOT NULL DEFAULT 0,
  "total_spend_cents" integer NOT NULL DEFAULT 0,
  "points_balance" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_public_id_idx" ON "customers" ("tenant_id", "public_id");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_email_idx" ON "customers" ("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "customers_lookup_idx" ON "customers" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "customers_birthday_idx" ON "customers" ("tenant_id", "birthday_month", "birthday_day");
CREATE INDEX IF NOT EXISTS "customers_inactive_idx" ON "customers" ("tenant_id", "last_visit_at");
CREATE INDEX IF NOT EXISTS "customers_source_idx" ON "customers" ("tenant_id", "source");
CREATE INDEX IF NOT EXISTS "customers_points_idx" ON "customers" ("tenant_id", "points_balance");

CREATE TABLE IF NOT EXISTS "tags" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#0f766e',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tags_tenant_name_idx" ON "tags" ("tenant_id", "name");

CREATE TABLE IF NOT EXISTS "customer_tags" (
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "tag_id" text NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  PRIMARY KEY ("customer_id", "tag_id")
);

CREATE INDEX IF NOT EXISTS "customer_tags_tag_id_idx" ON "customer_tags" ("tag_id");

CREATE TABLE IF NOT EXISTS "visits" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "amount_cents" integer NOT NULL DEFAULT 0,
  "staff_id" text,
  "note" text
);

CREATE INDEX IF NOT EXISTS "visits_tenant_occurred_idx" ON "visits" ("tenant_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "visits_customer_occurred_idx" ON "visits" ("customer_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "feedback" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "rating" integer NOT NULL,
  "comment" text,
  "status" text NOT NULL DEFAULT 'new',
  "follow_up_status" text NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "feedback_tenant_created_idx" ON "feedback" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "feedback_tenant_rating_idx" ON "feedback" ("tenant_id", "rating");
CREATE INDEX IF NOT EXISTS "feedback_customer_idx" ON "feedback" ("customer_id");

CREATE TABLE IF NOT EXISTS "segments" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "rules" text NOT NULL DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "segments_tenant_idx" ON "segments" ("tenant_id");

CREATE TABLE IF NOT EXISTS "services" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "duration_min" integer NOT NULL DEFAULT 30,
  "price_cents" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "services_tenant_name_idx" ON "services" ("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "services_tenant_active_idx" ON "services" ("tenant_id", "active");

CREATE TABLE IF NOT EXISTS "staff" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'staff',
  "active" boolean NOT NULL DEFAULT true,
  "availability" text NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "staff_tenant_active_idx" ON "staff" ("tenant_id", "active");

CREATE TABLE IF NOT EXISTS "appointments" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "service_id" text REFERENCES "services"("id") ON DELETE SET NULL,
  "staff_id" text REFERENCES "staff"("id") ON DELETE SET NULL,
  "start_at" timestamptz NOT NULL,
  "duration_min" integer NOT NULL DEFAULT 30,
  "status" text NOT NULL DEFAULT 'scheduled',
  "note" text,
  "reminder_sent_at" timestamptz,
  "follow_up_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "appointments_calendar_idx" ON "appointments" ("tenant_id", "start_at");
CREATE INDEX IF NOT EXISTS "appointments_status_idx" ON "appointments" ("tenant_id", "status", "start_at");
CREATE INDEX IF NOT EXISTS "appointments_customer_idx" ON "appointments" ("customer_id", "start_at");

CREATE TABLE IF NOT EXISTS "offers" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "kind" text NOT NULL DEFAULT 'discount',
  "value" integer NOT NULL DEFAULT 0,
  "channel" text NOT NULL DEFAULT 'email',
  "segment_id" text,
  "status" text NOT NULL DEFAULT 'active',
  "starts_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "offers_status_idx" ON "offers" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "offers_expires_at_idx" ON "offers" ("tenant_id", "expires_at");

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "offer_id" text REFERENCES "offers"("id") ON DELETE SET NULL,
  "customer_id" text REFERENCES "customers"("id") ON DELETE SET NULL,
  "code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "points_cost" integer,
  "expires_at" timestamptz,
  "redeemed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "coupons_tenant_code_idx" ON "coupons" ("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "coupons_tenant_status_idx" ON "coupons" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "offer_redemptions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "offer_id" text NOT NULL REFERENCES "offers"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "coupon_id" text,
  "idempotency_key" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "offer_redemptions_offer_customer_idx" ON "offer_redemptions" ("offer_id", "customer_id");
CREATE INDEX IF NOT EXISTS "offer_redemptions_tenant_created_idx" ON "offer_redemptions" ("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "reward_transactions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "points" integer NOT NULL,
  "reason" text NOT NULL,
  "balance_after" integer NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reward_txs_history_idx" ON "reward_transactions" ("tenant_id", "customer_id", "created_at");

CREATE TABLE IF NOT EXISTS "referral_codes" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "uses_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_codes_tenant_code_idx" ON "referral_codes" ("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "referral_codes_customer_idx" ON "referral_codes" ("tenant_id", "customer_id");

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
  "template" text NOT NULL,
  "segment_id" text,
  "filter" text NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'draft',
  "scheduled_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "campaigns_due_scan_idx" ON "campaigns" ("tenant_id", "status", "scheduled_at");

CREATE TABLE IF NOT EXISTS "messages" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "campaign_id" text REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'campaign',
  "subject" text,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "idempotency_key" text UNIQUE,
  "sent_at" timestamptz,
  "delivered_at" timestamptz,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "messages_customer_history_idx" ON "messages" ("tenant_id", "customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "messages_campaign_status_idx" ON "messages" ("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "messages_tenant_status_idx" ON "messages" ("tenant_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "workflows" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'custom',
  "trigger_type" text NOT NULL DEFAULT 'event',
  "trigger_event" text,
  "date_kind" text,
  "offset_minutes" integer,
  "condition_rules" text NOT NULL DEFAULT '[]',
  "segment_id" text,
  "channel" text NOT NULL DEFAULT 'email',
  "template" text NOT NULL,
  "require_consent" boolean NOT NULL DEFAULT true,
  "active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflows_dispatch_idx" ON "workflows" ("tenant_id", "active", "trigger_type");
CREATE INDEX IF NOT EXISTS "workflows_category_idx" ON "workflows" ("tenant_id", "category");

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "workflow_id" text NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "customer_id" text REFERENCES "customers"("id") ON DELETE SET NULL,
  "trigger_info" text NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'completed',
  "steps" text NOT NULL DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_idx" ON "workflow_runs" ("workflow_id", "created_at");
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_idx" ON "workflow_runs" ("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "payload" text NOT NULL DEFAULT '{}',
  "dedupe_key" text UNIQUE,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "processed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outbox_claim_scan_idx" ON "outbox_events" ("status", "available_at");
CREATE INDEX IF NOT EXISTS "outbox_tenant_status_idx" ON "outbox_events" ("tenant_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "scheduled_actions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" text NOT NULL DEFAULT '{}',
  "due_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "processed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "scheduled_actions_due_idx" ON "scheduled_actions" ("status", "due_at");
CREATE INDEX IF NOT EXISTS "scheduled_actions_tenant_idx" ON "scheduled_actions" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_id" text,
  "actor_label" text NOT NULL,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" text,
  "meta" text NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs" ("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "system_logs" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "level" text NOT NULL DEFAULT 'info',
  "scope" text NOT NULL,
  "message" text NOT NULL,
  "meta" text NOT NULL DEFAULT '{}',
  "tenant_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "system_logs_created_idx" ON "system_logs" ("created_at");

CREATE TABLE IF NOT EXISTS "usage_counters" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "metric" text NOT NULL,
  "day" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_counters_tenant_metric_day_idx" ON "usage_counters" ("tenant_id", "metric", "day");

-- ----------------------------------------------------------------
-- 2. PostgreSQL Row-Level Security (RLS) Configuration
-- Application roles cannot bypass tenant isolation policies.
-- ----------------------------------------------------------------

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offer_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies using transaction-local context:
-- Session initialization: SET LOCAL app.current_tenant_id = '<tenant_uuid>';

CREATE POLICY tenant_isolation_customers ON "customers"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_visits ON "visits"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_feedback ON "feedback"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_appointments ON "appointments"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_reward_txs ON "reward_transactions"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_outbox ON "outbox_events"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));
