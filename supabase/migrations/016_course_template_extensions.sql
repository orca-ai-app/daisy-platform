-- 016_course_template_extensions.sql
-- Two extensions to da_course_templates from Jenni's May 2026 feedback:
--   1. Promote the existing `certification` TEXT column to an explicit
--      enum-via-CHECK so the HQ edit form can render a Select with three
--      options (Yes / No / If requested). NULL is still permitted for
--      backwards compatibility with the seed rows from 006.
--   2. Add `default_ticket_types` JSONB so HQ can define the ticket-type
--      defaults (Single / Double / Special, etc.) once on the template, and
--      M2 Wave 7's create-course-instance Edge Function will cascade those
--      defaults into da_ticket_types when a franchisee creates an instance.
--
-- Reference: plan §3 "016_course_template_extensions.sql" and §4.5
-- TemplatesPage UI changes.

-- 1. certification: default + check constraint --------------------------------
-- The column already exists as TEXT (001_initial_schema.sql:78) and is
-- nullable. We only add a default and a CHECK; no column redefinition.
ALTER TABLE da_course_templates
  ALTER COLUMN certification SET DEFAULT 'no';

ALTER TABLE da_course_templates
  ADD CONSTRAINT da_course_templates_certification_chk
    CHECK (certification IS NULL OR certification IN ('yes', 'no', 'if_requested'));

COMMENT ON COLUMN da_course_templates.certification IS
  'Whether attendees receive a certificate. One of yes | no | if_requested, or NULL for legacy templates. Editable via the HQ template form.';

-- 2. default_ticket_types ------------------------------------------------------
-- JSONB array of { name, seats_consumed, price_modifier_pence }. Default is a
-- single "Single" entry so existing courses behave exactly as before until HQ
-- edits the template.
ALTER TABLE da_course_templates
  ADD COLUMN default_ticket_types JSONB NOT NULL DEFAULT
    '[{"name":"Single","seats_consumed":1,"price_modifier_pence":0}]'::jsonb;

COMMENT ON COLUMN da_course_templates.default_ticket_types IS
  'Ticket-type defaults cloned into da_ticket_types when a course instance is created (M2 Wave 7). Each element: { name TEXT, seats_consumed INTEGER, price_modifier_pence INTEGER }.';
