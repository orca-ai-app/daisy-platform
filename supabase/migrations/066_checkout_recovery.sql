-- 066_checkout_recovery.sql
--
-- W4 abandoned checkout recovery (Jenni approved 16 Sep 2026, £500).
-- When the send-emails sweep expires an unpaid online checkout, it queues ONE
-- 'checkout_recovery' email about an hour later. The email links back to the
-- class's /book/:token page with ?resume=<resume_token>, which pre-fills the
-- customer's details, ticket and quantity so they can finish in one go.

-- Unguessable per-booking token for the resume link. Only set on expired
-- online checkouts; everything else stays null.
alter table da_bookings add column if not exists resume_token text;
create unique index if not exists da_bookings_resume_token_key
  on da_bookings (resume_token)
  where resume_token is not null;

-- Allow the new journey key. Recreated with every existing key plus the new one.
alter table da_email_sequences drop constraint if exists da_email_sequences_template_key_check;
alter table da_email_sequences add constraint da_email_sequences_template_key_check
  check (template_key = any (array[
    'post_course_welcome', 'recap_anaphylaxis', 'recap_choking', 'recap_head_injuries',
    'recap_cpr', 'recap_febrile_convulsions', 'recap_burns', 'quiz_general', 'refresher',
    'refresher_elearning_option', 'new_booking_notification', 'booking_confirmation',
    'medical_reminder', 'day_before_reminder', 'interest_form_hq', 'course_updated',
    'product_purchase_confirmation', 'fee_invoice', 'fee_chase_1', 'fee_chase_2', 'fee_failed',
    'thank_you', 'refresher_6w', 'refresher_3m', 'refresher_6m', 'refresher_9m',
    'refresher_12m', 'quiz_prompt', 'checkout_recovery'
  ]::text[]));

-- One recovery email per abandoned booking, ever.
create unique index if not exists da_email_sequences_one_recovery
  on da_email_sequences (booking_id)
  where template_key = 'checkout_recovery';
