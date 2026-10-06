-- 067: attendee emails for trainers from the medical form (PRD October batch B7).
--
-- The new medical form (form_version 2) tells the attendee, beside the email
-- box, "Your trainer will use this to send your certificate and anything from
-- the class", and adds an optional, unticked box: "I'm happy to hear from my
-- trainer about future classes and to be asked for a review". The separate
-- "Email me about my certificate" tick (migration 065) is retired on the new
-- form; for a new-form submission that gives an email, submit-medical-
-- declaration sets certificate_opt_in = true and certificate_email to that
-- address, so the existing certificate features keep working.
--
-- FORWARD-ONLY. Every existing row keeps form_version = 1 and
-- trainer_contact_opt_in = false; nothing is backfilled. form_version is only
-- ever 2 when the submission itself says so (the new form sends it), so a
-- declaration made on the old wording can never be shown with the new promise.
-- The class page and Customers page show the email and the "future classes"
-- choice only for form_version >= 2 rows; older rows look exactly as before.
--
-- RLS is unchanged and covers the new columns: live policies (checked
-- 6 Oct 2026 in pg_policy) are franchisee_own
-- (franchisee_id = get_current_franchisee_id()) and hq_full_access
-- (is_hq_user()), so a trainer only ever reads their own attendees. Health
-- answers (declaration_data) stay encrypted and HQ-only.
--
-- Additive only: safe to apply before the code ships (old code ignores the
-- columns). Apply it BEFORE deploying submit-medical-declaration or merging the
-- portal, both of which read or write these columns.

ALTER TABLE da_medical_declarations
  ADD COLUMN IF NOT EXISTS form_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trainer_contact_opt_in boolean NOT NULL DEFAULT false;

-- Only known versions, and the "future classes" choice exists only on the new
-- form and always comes with an address.
ALTER TABLE da_medical_declarations
  DROP CONSTRAINT IF EXISTS da_medical_declarations_form_version_chk;
ALTER TABLE da_medical_declarations
  ADD CONSTRAINT da_medical_declarations_form_version_chk
  CHECK (form_version IN (1, 2));

ALTER TABLE da_medical_declarations
  DROP CONSTRAINT IF EXISTS da_medical_declarations_trainer_contact_chk;
ALTER TABLE da_medical_declarations
  ADD CONSTRAINT da_medical_declarations_trainer_contact_chk
  CHECK (
    trainer_contact_opt_in = false
    OR (form_version >= 2 AND attendee_email IS NOT NULL)
  );

COMMENT ON COLUMN da_medical_declarations.form_version IS
  'Medical form wording the attendee saw. 1 = before B7 (Oct 2026); 2 = email shared with the trainer for the certificate and anything from the class (migration 067). Never backfilled.';
COMMENT ON COLUMN da_medical_declarations.trainer_contact_opt_in IS
  'Form v2 only: attendee ticked "I''m happy to hear from my trainer about future classes and to be asked for a review" (migration 067).';
