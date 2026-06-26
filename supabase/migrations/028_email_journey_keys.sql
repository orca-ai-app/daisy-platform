-- 028_email_journey_keys.sql
-- M3 Wave 13. Widens da_email_sequences.template_key to the real Daisy email
-- journey taken from Jenni's Kartra automation (docs/M3-email-journey.md), plus
-- the transactional/notification keys. This SUPERSEDES migration 020's generic
-- interval names — but we keep the old keys in the allowed set too, so any
-- in-flight pending rows queued by the M2-era webhook remain valid.
--
-- Canonical post-course journey (10, from Kartra):
--   post_course_welcome, recap_anaphylaxis, recap_choking, recap_head_injuries,
--   recap_cpr, recap_febrile_convulsions, recap_burns, quiz_general, refresher,
--   refresher_elearning_option
-- Transactional / notifications:
--   new_booking_notification, booking_confirmation, medical_reminder, interest_form_hq
-- Billing (Phase 2): fee_invoice, fee_chase_1, fee_chase_2, fee_failed
-- Legacy (kept so old pending rows don't violate): thank_you, refresher_6w/3m/6m/9m/12m, quiz_prompt
--
-- This is migration 028 — do NOT renumber.

ALTER TABLE da_email_sequences
  DROP CONSTRAINT IF EXISTS da_email_sequences_template_key_check;

ALTER TABLE da_email_sequences
  ADD CONSTRAINT da_email_sequences_template_key_check
  CHECK (template_key IN (
    -- Kartra post-course journey
    'post_course_welcome',
    'recap_anaphylaxis',
    'recap_choking',
    'recap_head_injuries',
    'recap_cpr',
    'recap_febrile_convulsions',
    'recap_burns',
    'quiz_general',
    'refresher',
    'refresher_elearning_option',
    -- Transactional / notifications
    'new_booking_notification',
    'booking_confirmation',
    'medical_reminder',
    'interest_form_hq',
    -- Billing (Phase 2)
    'fee_invoice',
    'fee_chase_1',
    'fee_chase_2',
    'fee_failed',
    -- Legacy (migration 020) — kept for in-flight rows
    'thank_you',
    'refresher_6w',
    'refresher_3m',
    'refresher_6m',
    'refresher_9m',
    'refresher_12m',
    'quiz_prompt'
  ));

COMMENT ON COLUMN da_email_sequences.template_key IS
  'Email template identifier (migration 028). Canonical set = Kartra post-course journey + transactional + billing keys; legacy interval keys retained. send-emails renders the matching template from supabase/functions/send-emails/templates/.';
