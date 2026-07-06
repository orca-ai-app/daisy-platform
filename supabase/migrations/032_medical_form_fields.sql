-- 032_medical_form_fields.sql
-- Attendee medical capture → booking linkage + email enrolment (July 2026).
-- Adds the three plaintext fields the rebuilt medical form captures alongside
-- the encrypted health blob:
--
--   email_opt_in     — the attendee ticked Jenni's Kartra opt-in ("I'd like to
--                      get emails packed full of useful content to help me.").
--                      Drives enrolment in the post-course journey.
--   photo_consent    — "Can we use any photos taken of you or your minors today
--                      for Daisy First Aid promotion?" Yes/No. PLAINTEXT by
--                      design: trainers need day-of visibility and cannot
--                      decrypt the health blob; photo consent is not health data.
--   booker_reference — what the attendee typed for "Who made the booking?"
--                      (name or email). Kept verbatim for audit/re-matching;
--                      the resolved link lands in the existing booking_id column.
--
-- This is migration 032 — do NOT renumber.

ALTER TABLE da_medical_declarations
  ADD COLUMN email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN photo_consent BOOLEAN,
  ADD COLUMN booker_reference TEXT;

COMMENT ON COLUMN da_medical_declarations.email_opt_in IS
  'Attendee ticked the marketing opt-in on the medical form. Gates post-course email enrolment (submit-medical-declaration).';
COMMENT ON COLUMN da_medical_declarations.photo_consent IS
  'Photo/promotion consent (plaintext — trainer needs day-of visibility; not special-category data). NULL = not asked (pre-032 rows).';
COMMENT ON COLUMN da_medical_declarations.booker_reference IS
  'Verbatim "who made the booking" answer used to resolve booking_id. Audit trail for the match.';
