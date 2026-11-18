-- ==============================================================================
-- GS ClientFlow — Migration 0002: Vertical Automations & RLS Policies
-- Expands schema for Coaching, Gym, and Salon vertical pipelines with strict RLS.
-- ==============================================================================

-- 1. Extend tenants table with vertical classification
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vertical_type text NOT NULL DEFAULT 'GENERAL';

-- 2. Extend appointments table with salon ambient preferences and check-in tracking
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_staff_id text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS preferences text NOT NULL DEFAULT '{}';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS check_in_status text NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz;

-- 3. Create staff_members table
CREATE TABLE IF NOT EXISTS staff_members (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  phone text,
  specialties text NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_members_tenant_active_idx ON staff_members(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS staff_members_role_idx ON staff_members(tenant_id, role);

-- 4. Create attendance_logs table (Coaching Vertical)
CREATE TABLE IF NOT EXISTS attendance_logs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  batch_or_class text NOT NULL,
  date text NOT NULL,
  status text NOT NULL DEFAULT 'PRESENT',
  guardian_phone text NOT NULL,
  notified_at timestamptz,
  guardian_reply_status text NOT NULL DEFAULT 'PENDING',
  guardian_reply_text text,
  follow_up_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_logs_tenant_date_idx ON attendance_logs(tenant_id, date);
CREATE INDEX IF NOT EXISTS attendance_logs_batch_date_idx ON attendance_logs(tenant_id, batch_or_class, date);
CREATE INDEX IF NOT EXISTS attendance_logs_customer_idx ON attendance_logs(customer_id, date);
CREATE INDEX IF NOT EXISTS attendance_logs_reply_status_idx ON attendance_logs(tenant_id, guardian_reply_status);

-- 5. Create staff_follow_up_tasks table (Escalation Queue)
CREATE TABLE IF NOT EXISTS staff_follow_up_tasks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  assigned_to_user_id text REFERENCES users(id) ON DELETE SET NULL,
  task_type text NOT NULL DEFAULT 'ATTENDANCE_CALL',
  status text NOT NULL DEFAULT 'OPEN',
  due_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_follow_up_tasks_tenant_status_idx ON staff_follow_up_tasks(tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS staff_follow_up_tasks_customer_idx ON staff_follow_up_tasks(customer_id);

-- 6. Create memberships table (Gym Vertical)
CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  price_amount integer NOT NULL DEFAULT 0,
  start_date timestamptz NOT NULL DEFAULT now(),
  expiry_date timestamptz NOT NULL,
  payment_status text NOT NULL DEFAULT 'PENDING',
  status text NOT NULL DEFAULT 'ACTIVE',
  last_reminder_sent_at timestamptz,
  auto_sync_sheet_row_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memberships_tenant_status_idx ON memberships(tenant_id, status, expiry_date);
CREATE INDEX IF NOT EXISTS memberships_customer_idx ON memberships(customer_id);
CREATE INDEX IF NOT EXISTS memberships_payment_status_idx ON memberships(tenant_id, payment_status);

-- 7. Apply ENABLE and FORCE ROW LEVEL SECURITY
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'staff_members',
    'attendance_logs',
    'staff_follow_up_tasks',
    'memberships'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());',
      tbl || '_tenant_isolation',
      tbl
    );
  END LOOP;
END $$;
