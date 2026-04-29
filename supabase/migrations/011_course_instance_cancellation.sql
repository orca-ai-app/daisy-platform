-- 011_course_instance_cancellation.sql
-- Add cancellation_reason to da_course_instances so HQ (and later the
-- franchisee) can record why a course was cancelled.
--
-- Reference: docs/M1-build-plan.md §6 Wave 4 Agent 4B (course override).
-- The Edge Function `cancel-course-instance` stamps this column when
-- transitioning a course to status='cancelled'.

ALTER TABLE da_course_instances
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN da_course_instances.cancellation_reason IS
  'Free-text reason captured when status transitions to cancelled. Set by HQ via cancel-course-instance Edge Function (Wave 4B). Never UPDATEd in place after that.';
