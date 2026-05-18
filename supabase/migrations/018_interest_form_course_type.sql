-- 018_interest_form_course_type.sql
-- Adds da_interest_forms.course_template_id so the public booking widget
-- can capture which course type a prospect is interested in when they fill
-- the vacant-territory interest form.
--
-- Background: Jenni's May 2026 feedback (#13) — the interest form should
-- ask "what type of course do you need?". The widget UI lands in M3 Wave 10
-- (daisy-booking); the schema lands now so the column exists before the
-- widget reads it. The HQ-side interest form review page can display the
-- joined template name in the meantime.
--
-- Reference: plan §3 "018_interest_form_course_type.sql" and §4.9.

ALTER TABLE da_interest_forms
  ADD COLUMN course_template_id UUID REFERENCES da_course_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN da_interest_forms.course_template_id IS 'Course type the prospect wants. Captured by the booking widget (M3 Wave 10); displayed on the HQ interest forms page joined to da_course_templates.name.';

CREATE INDEX idx_interest_forms_course_template_id ON da_interest_forms(course_template_id);
