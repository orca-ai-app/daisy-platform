-- 065: certificate opt-in tick on the medical form (PRD W5, October retainer).
--
-- An attendee may tick "Email me about my certificate". Only then is the email
-- they gave copied into certificate_email, which the trainer sees on the class
-- page (Medical declarations card, with a copy-all) and HQ sees in
-- /hq/medical-declarations. The address is held for that purpose only: it is
-- never a marketing list and never enrols anyone in a journey (email_opt_in
-- stays the only route into post-course emails).
--
-- Forward-only: existing declarations keep certificate_opt_in = false and a
-- null certificate_email; nothing is backfilled from attendee_email.
--
-- RLS is unchanged: franchisee_own (franchisee_id = get_current_franchisee_id())
-- and hq_full_access already cover new columns on this table. The row is
-- deleted by the retention purge and GDPR erasure along with the declaration.

ALTER TABLE da_medical_declarations
  ADD COLUMN IF NOT EXISTS certificate_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_email text;

-- The two travel together: an address only when ticked, and a tick always
-- carries an address.
ALTER TABLE da_medical_declarations
  DROP CONSTRAINT IF EXISTS da_medical_declarations_certificate_email_chk;
ALTER TABLE da_medical_declarations
  ADD CONSTRAINT da_medical_declarations_certificate_email_chk
  CHECK (
    (certificate_opt_in = false AND certificate_email IS NULL)
    OR (
      certificate_opt_in = true
      AND certificate_email IS NOT NULL
      AND char_length(certificate_email) BETWEEN 3 AND 320
      AND certificate_email LIKE '%_@_%'
    )
  );

COMMENT ON COLUMN da_medical_declarations.certificate_opt_in IS
  'Attendee ticked "Email me about my certificate" on the medical form (migration 065).';
COMMENT ON COLUMN da_medical_declarations.certificate_email IS
  'Set only when certificate_opt_in; shown to the class trainer and HQ for certificate information only. Never marketing.';
