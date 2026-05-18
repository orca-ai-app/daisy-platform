-- 017_franchisee_template_overrides.sql
-- Per-franchisee overrides on shared course templates. Course templates stay
-- as immutable network-wide rows (everyone reads, HQ writes); when a
-- franchisee needs a different price / capacity / description / ticket-type
-- set for themselves, they upsert a row here. NULL columns inherit the
-- template value.
--
-- Background: Jenni's May 2026 feedback (#8) — HQ wants the option for
-- franchisees to amend a course for themselves while the network template
-- stays fixed for everyone else. M1 lands the schema; M2 Wave 7 ships the
-- franchisee-side UI and the create-course-instance Edge Function that reads
-- this table when prefilling the create-course wizard.
--
-- Reference: plan §3 "017_franchisee_template_overrides.sql" and §4.5.
-- RLS helpers `get_current_franchisee_id()` and `is_hq_user()` come from
-- 008_helper_functions.sql.

CREATE TABLE da_franchisee_template_overrides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id        UUID NOT NULL REFERENCES da_franchisees(id) ON DELETE CASCADE,
  course_template_id   UUID NOT NULL REFERENCES da_course_templates(id) ON DELETE CASCADE,
  name                 TEXT,
  duration_hours       NUMERIC(4,2),
  default_price_pence  INTEGER CHECK (default_price_pence IS NULL OR default_price_pence >= 0),
  default_capacity     INTEGER CHECK (default_capacity IS NULL OR default_capacity > 0),
  description          TEXT,
  default_ticket_types JSONB,
  is_active            BOOLEAN,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (franchisee_id, course_template_id)
);

COMMENT ON TABLE  da_franchisee_template_overrides IS 'Per-franchisee overrides on shared course templates. NULL column = inherit from template. M2 Wave 7 reads these when prefilling the create-course wizard.';
COMMENT ON COLUMN da_franchisee_template_overrides.name IS 'Nullable: only set if the franchisee renamed the course for their listings.';
COMMENT ON COLUMN da_franchisee_template_overrides.default_ticket_types IS 'Nullable JSONB array matching da_course_templates.default_ticket_types shape. NULL inherits from the template.';

CREATE INDEX idx_franchisee_template_overrides_franchisee_id
  ON da_franchisee_template_overrides(franchisee_id);
CREATE INDEX idx_franchisee_template_overrides_template_id
  ON da_franchisee_template_overrides(course_template_id);

-- RLS --------------------------------------------------------------------------
-- Pattern follows 010_rls_policies.sql: HQ has full access; franchisees see
-- and edit only their own rows. service_role bypass is implicit (Edge
-- Functions use it); no service_role policy needed.

ALTER TABLE da_franchisee_template_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "franchisee_own" ON da_franchisee_template_overrides
  FOR ALL TO authenticated
  USING (franchisee_id = get_current_franchisee_id() OR is_hq_user())
  WITH CHECK (franchisee_id = get_current_franchisee_id() OR is_hq_user());
