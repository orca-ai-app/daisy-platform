-- 061: day-before reminder email (approved item 3, Sep 2026).
--
-- Every booked customer gets a reminder 24 hours before their class starts
-- (same wall-clock time, the day before). The email itself is the
-- 'day_before_reminder' transactional template in send-emails/templates.ts;
-- scheduling is one more row in the per-booking journey built by
-- _shared/emailSchedule.ts, drained hourly by send-emails, and protected by
-- the existing lifecycle gate (a cancelled booking or class cancels the row
-- at send time rather than emailing anyone).
--
-- 1. Widen the sequences CHECK (supersedes migration 028's constraint) to
--    allow the new key.
-- 2. Backfill: bookings made BEFORE this shipped would otherwise never get
--    the reminder, so queue rows for every confirmed booking whose reminder
--    moment is still in the future. Covers online AND manually-added
--    (offline) bookings; create-booking queues the reminder for new offline
--    bookings from now on. AT TIME ZONE 'Europe/London' handles GMT/BST.

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
    'day_before_reminder',
    'interest_form_hq',
    -- Present in live data since the 049-058 era (the 028 constraint was not
    -- on the live table): course-change emails (NTH-14) + shop purchases.
    'course_updated',
    'product_purchase_confirmation',
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
  'Email template identifier. Constrained to the known set by da_email_sequences_template_key_check (migration 061, supersedes 028).';

-- Backfill the reminder for existing future bookings (idempotent).
INSERT INTO da_email_sequences (customer_id, booking_id, template_key, sequence_day, scheduled_for, status)
SELECT
  b.customer_id,
  b.id,
  'day_before_reminder',
  0,
  (((ci.event_date::text || ' ' || COALESCE(ci.start_time::text, '00:00:00'))::timestamp)
     AT TIME ZONE 'Europe/London') - interval '24 hours',
  'pending'
FROM da_bookings b
JOIN da_course_instances ci ON ci.id = b.course_instance_id
WHERE b.booking_status = 'confirmed'
  AND b.customer_id IS NOT NULL
  AND ci.status = 'scheduled'
  AND ((((ci.event_date::text || ' ' || COALESCE(ci.start_time::text, '00:00:00'))::timestamp)
          AT TIME ZONE 'Europe/London') - interval '24 hours') > now()
  AND NOT EXISTS (
    SELECT 1 FROM da_email_sequences s
    WHERE s.booking_id = b.id AND s.template_key = 'day_before_reminder'
  );
