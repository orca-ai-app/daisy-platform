-- 010_rls_policies.sql
-- RLS policies — two-policy pattern per PRD §4.18.
-- service_role bypass is implicit (Edge Functions use it); no service_role policies here.
--
-- Pattern per the M1 plan / agent prompt:
-- * Tables with franchisee_id: hq_full_access + franchisee_own
-- * da_customers:               hq_full_access + franchisee_read_own_customers
-- * da_course_templates:        all_read + hq_write
-- * tables without franchisee_id: derived equivalents (HQ full + franchisee scope
--   via the joining table that does have franchisee_id).

-- da_franchisees --------------------------------------------------------------
-- Franchisees can read+update their own row (so they can edit profile in M2).
-- HQ has full access including listing every franchisee.
ALTER TABLE da_franchisees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_franchisees
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_franchisees
  FOR ALL USING (id = get_current_franchisee_id());

-- da_territories --------------------------------------------------------------
ALTER TABLE da_territories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_territories
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_territories
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_course_templates ---------------------------------------------------------
-- Public-readable so the booking widget (anon) can list templates.
ALTER TABLE da_course_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_read" ON da_course_templates
  FOR SELECT USING (TRUE);

CREATE POLICY "hq_write" ON da_course_templates
  FOR ALL USING (is_hq_user());

-- da_course_instances ---------------------------------------------------------
ALTER TABLE da_course_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_course_instances
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_course_instances
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_ticket_types -------------------------------------------------------------
-- No franchisee_id directly; scope through course_instance.
ALTER TABLE da_ticket_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_ticket_types
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_ticket_types
  FOR ALL USING (
    course_instance_id IN (
      SELECT id FROM da_course_instances
      WHERE franchisee_id = get_current_franchisee_id()
    )
  );

-- da_customers ----------------------------------------------------------------
-- Per PRD §4.18 explicit example.
ALTER TABLE da_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_customers
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_read_own_customers" ON da_customers
  FOR SELECT USING (
    id IN (
      SELECT customer_id FROM da_bookings
      WHERE franchisee_id = get_current_franchisee_id()
    )
  );

-- da_private_clients ----------------------------------------------------------
ALTER TABLE da_private_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_private_clients
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_private_clients
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_bookings -----------------------------------------------------------------
ALTER TABLE da_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_bookings
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_bookings
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_medical_declarations -----------------------------------------------------
ALTER TABLE da_medical_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_medical_declarations
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_medical_declarations
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_interest_forms -----------------------------------------------------------
-- No franchisee_id (forms come from customers in vacant territories). HQ-managed.
-- We let any logged-in franchisee SELECT — they may need visibility for territories
-- they could be assigned. Writes: HQ only.
ALTER TABLE da_interest_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_interest_forms
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_read_all" ON da_interest_forms
  FOR SELECT USING (get_current_franchisee_id() IS NOT NULL);

-- da_discount_codes -----------------------------------------------------------
-- franchisee_id NULL means network-wide; franchisees should see their own
-- and the network-wide ones.
ALTER TABLE da_discount_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_discount_codes
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_discount_codes
  FOR ALL USING (
    franchisee_id = get_current_franchisee_id()
    OR (franchisee_id IS NULL AND get_current_franchisee_id() IS NOT NULL)
  );

-- da_billing_runs -------------------------------------------------------------
ALTER TABLE da_billing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_billing_runs
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_billing_runs
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_email_sequences ----------------------------------------------------------
-- Scoped via the booking it belongs to.
ALTER TABLE da_email_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_email_sequences
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_email_sequences
  FOR ALL USING (
    booking_id IN (
      SELECT id FROM da_bookings
      WHERE franchisee_id = get_current_franchisee_id()
    )
  );

-- da_activities ---------------------------------------------------------------
-- Insert-only audit log. HQ sees all. Franchisees see activities where they are
-- the actor — pragmatic franchisee-scoped audit view.
ALTER TABLE da_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_activities
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_read_own" ON da_activities
  FOR SELECT USING (
    actor_type = 'franchisee'
    AND actor_id = get_current_franchisee_id()
  );

-- da_settings -----------------------------------------------------------------
-- Network-wide settings. Everyone authenticated reads; only HQ writes.
ALTER TABLE da_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_authenticated_read" ON da_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "hq_write" ON da_settings
  FOR ALL USING (is_hq_user());
