-- ==============================================================================
-- GS ClientFlow — Migration 0001: Harden PostgreSQL Row-Level Security (RLS)
-- Mandate FORCE ROW LEVEL SECURITY to prevent application DB roles or table owners
-- from bypassing tenant isolation, and standardize transaction-scoped tenant setting.
-- ==============================================================================

-- Helper function to resolve active tenant safely
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(current_setting('app.tenant_id', true), ''),
    NULLIF(current_setting('app.current_tenant_id', true), '')
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. Apply ENABLE + FORCE ROW LEVEL SECURITY across all tenant-partitioned tables

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'users',
    'sessions',
    'customers',
    'tags',
    'customer_tags',
    'visits',
    'feedback',
    'segments',
    'services',
    'staff',
    'appointments',
    'offers',
    'coupons',
    'offer_redemptions',
    'reward_transactions',
    'referral_codes',
    'campaigns',
    'messages',
    'workflows',
    'workflow_runs',
    'outbox_events',
    'scheduled_actions',
    'audit_logs',
    'usage_counters'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END $$;

-- 2. Drop legacy policies if they exist and recreate with hardened FORCE constraints

DROP POLICY IF EXISTS tenant_isolation_customers ON "customers";
CREATE POLICY tenant_isolation_customers ON "customers"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_users ON "users";
CREATE POLICY tenant_isolation_users ON "users"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_sessions ON "sessions";
CREATE POLICY tenant_isolation_sessions ON "sessions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_tags ON "tags";
CREATE POLICY tenant_isolation_tags ON "tags"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_customer_tags ON "customer_tags";
CREATE POLICY tenant_isolation_customer_tags ON "customer_tags"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "customers" c
      WHERE c.id = customer_tags.customer_id AND c.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "customers" c
      WHERE c.id = customer_tags.customer_id AND c.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS tenant_isolation_visits ON "visits";
CREATE POLICY tenant_isolation_visits ON "visits"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_feedback ON "feedback";
CREATE POLICY tenant_isolation_feedback ON "feedback"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_segments ON "segments";
CREATE POLICY tenant_isolation_segments ON "segments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_services ON "services";
CREATE POLICY tenant_isolation_services ON "services"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_staff ON "staff";
CREATE POLICY tenant_isolation_staff ON "staff"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_appointments ON "appointments";
CREATE POLICY tenant_isolation_appointments ON "appointments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_offers ON "offers";
CREATE POLICY tenant_isolation_offers ON "offers"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_coupons ON "coupons";
CREATE POLICY tenant_isolation_coupons ON "coupons"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_offer_redemptions ON "offer_redemptions";
CREATE POLICY tenant_isolation_offer_redemptions ON "offer_redemptions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_reward_transactions ON "reward_transactions";
CREATE POLICY tenant_isolation_reward_transactions ON "reward_transactions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_referral_codes ON "referral_codes";
CREATE POLICY tenant_isolation_referral_codes ON "referral_codes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_campaigns ON "campaigns";
CREATE POLICY tenant_isolation_campaigns ON "campaigns"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_messages ON "messages";
CREATE POLICY tenant_isolation_messages ON "messages"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflows ON "workflows";
CREATE POLICY tenant_isolation_workflows ON "workflows"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_runs ON "workflow_runs";
CREATE POLICY tenant_isolation_workflow_runs ON "workflow_runs"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_outbox_events ON "outbox_events";
CREATE POLICY tenant_isolation_outbox_events ON "outbox_events"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_scheduled_actions ON "scheduled_actions";
CREATE POLICY tenant_isolation_scheduled_actions ON "scheduled_actions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_audit_logs ON "audit_logs";
CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_usage_counters ON "usage_counters";
CREATE POLICY tenant_isolation_usage_counters ON "usage_counters"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
