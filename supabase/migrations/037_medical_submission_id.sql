-- 037_medical_submission_id.sql
-- Idempotent medical-form retries: the form generates one submission_id per
-- session and reuses it on retry; the unique index turns a double-submit
-- (slow network, double tap) into a friendly duplicate response instead of a
-- second declaration row.
--
-- This is migration 037 — do NOT renumber.

ALTER TABLE da_medical_declarations
  ADD COLUMN submission_id TEXT;

CREATE UNIQUE INDEX idx_medical_declarations_submission_id
  ON da_medical_declarations (submission_id)
  WHERE submission_id IS NOT NULL;

COMMENT ON COLUMN da_medical_declarations.submission_id IS
  'Client-generated idempotency key (migration 037). NULL for pre-037 rows.';
