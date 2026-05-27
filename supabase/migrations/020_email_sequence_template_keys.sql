-- 020_email_sequence_template_keys.sql
-- Constrains da_email_sequences.template_key to the known set of email
-- templates the send-emails cron knows how to render.
--
-- Background: 005_billing_tables.sql created da_email_sequences.template_key
-- as a free-text TEXT column. Every consumer (the cron drainer, the
-- franchisee notification flow, the post-event refresher scheduler) keys off
-- a fixed enum of template identifiers, so a typo in an inserter would
-- silently queue an unrenderable email. This CHECK turns that into an insert
-- error at the boundary.
--
-- Template set: there is no PRD-technical.md §4.14 in this repo (only the M1
-- handover/demo docs exist), so the set below is derived from the Wave 9
-- scaffold brief and the M1 handover's email-sequence description
-- (booking notifications, confirmations, post-course refreshers). If the
-- canonical PRD list ever materialises, reconcile against it — this set is
-- intentionally the documented one, not a guess at a broader superset.
--
-- The table is empty at this point in the migration order (sequences are
-- populated post-event by the cron, which only ships in M3), so no existing
-- row can violate the constraint. The guard below makes that assumption
-- explicit and fails loudly if a future re-order ever puts data here first.
--
-- This is migration 020 — do NOT renumber.

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM da_email_sequences
  WHERE template_key NOT IN (
    'new_booking_notification',
    'booking_confirmation',
    'thank_you',
    'refresher_6w',
    'refresher_3m',
    'refresher_6m',
    'refresher_9m',
    'refresher_12m',
    'quiz_prompt',
    'fee_invoice',
    'fee_chase_1',
    'fee_chase_2'
  );

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add template_key CHECK: % existing da_email_sequences row(s) use a template_key outside the known set',
      bad_count;
  END IF;
END $$;

ALTER TABLE da_email_sequences
  ADD CONSTRAINT da_email_sequences_template_key_check
  CHECK (template_key IN (
    'new_booking_notification',
    'booking_confirmation',
    'thank_you',
    'refresher_6w',
    'refresher_3m',
    'refresher_6m',
    'refresher_9m',
    'refresher_12m',
    'quiz_prompt',
    'fee_invoice',
    'fee_chase_1',
    'fee_chase_2'
  ));

COMMENT ON COLUMN da_email_sequences.template_key IS 'Email template identifier. Constrained to the known set by da_email_sequences_template_key_check (migration 020).';
