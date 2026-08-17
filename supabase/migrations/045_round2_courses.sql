-- 045_round2_courses.sql
-- Round 2 franchisee feedback (Feola, 2026-08) — course scheduling fixes.
--
-- G1: let a franchisee write their own customer-facing class description.
--
-- Every class currently inherits its description from the template. For the
-- bespoke/private template that text is "Bespoke first aid class, typically
-- around two hours; price agreed per booking. Suitable for anyone." — which is
-- wrong for most of the private classes franchisees actually run, and they had
-- no way to change it. This column is an OPTIONAL per-instance override: NULL
-- (the default) means "use the template description", exactly as today.
--
-- The public booking surface prefers description_override when it is present
-- and non-empty, otherwise it falls back to da_course_templates.description.
--
-- This is migration 045 — do NOT renumber.

ALTER TABLE da_course_instances
  ADD COLUMN IF NOT EXISTS description_override TEXT;

COMMENT ON COLUMN da_course_instances.description_override IS
  'Optional franchisee-written class description shown to customers. NULL falls back to da_course_templates.description.';
