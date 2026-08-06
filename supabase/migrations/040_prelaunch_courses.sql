-- 040_prelaunch_courses.sql
-- Pre-launch course changes (Jenni feedback, 2026-08):
--   NTH-9  Private classes with partial info — venue_postcode becomes nullable
--          (venue TBC), plus display_name (customer-facing class name override)
--          and venue_tbc flag on da_course_instances. Enforcement of "public
--          courses still require a full postcode" lives in the
--          create/update-course-instance Edge Functions, NOT in a CHECK —
--          private courses may carry a full postcode, an outcode, or nothing.
--   NTH-15 Per-ticket session labels — da_ticket_types.session_label
--          (e.g. '6-hour · 9:30–15:30').
--   NTH-11 VAT rate per ticket type — da_ticket_types.vat_rate (percentage,
--          e.g. 20.00). NULL = no VAT treatment recorded. Portal display only;
--          billing exports are out of scope here.
--   NTH-14 Course change notifications — adds 'course_updated' to the
--          da_email_sequences.template_key CHECK (superseding migration 028's
--          set) so update-course-instance can queue one row per confirmed
--          booking when a class's date/time/venue changes.
--
-- lat/lng on da_course_instances are already nullable (migration 002) and the
-- da_course_instances_set_geom trigger (migration 007) only touches geom when
-- BOTH lat and lng are non-null, so venue-TBC rows (lat/lng NULL) need no
-- trigger guard. find_nearest_courses (039) filters on geom IS NOT NULL, so
-- TBC rows simply never surface in the public search.
--
-- This is migration 040 — do NOT renumber.

-- da_course_instances -----------------------------------------------------------

ALTER TABLE da_course_instances
  ALTER COLUMN venue_postcode DROP NOT NULL;

ALTER TABLE da_course_instances
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE da_course_instances
  ADD COLUMN IF NOT EXISTS venue_tbc BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN da_course_instances.venue_postcode IS
  'Full postcode (public courses, required — enforced in the Edge Functions), outcode only (private courses, e.g. GU1), or NULL when venue_tbc (private courses only).';
COMMENT ON COLUMN da_course_instances.display_name IS
  'Optional customer-facing class name override (e.g. "BOOKED – Private 2hr Class for Anne S"). Falls back to the template name when NULL.';
COMMENT ON COLUMN da_course_instances.venue_tbc IS
  'TRUE when the venue is not yet confirmed (private courses only). lat/lng/geom stay NULL; territory_id falls back to the franchisee''s own primary territory.';

-- da_ticket_types ---------------------------------------------------------------

ALTER TABLE da_ticket_types
  ADD COLUMN IF NOT EXISTS session_label TEXT;

ALTER TABLE da_ticket_types
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(4,2);

COMMENT ON COLUMN da_ticket_types.session_label IS
  'Optional session details shown under the ticket name (e.g. "6-hour · 9:30–15:30", "12-hour over 2 days").';
COMMENT ON COLUMN da_ticket_types.vat_rate IS
  'Optional VAT rate percentage this ticket price includes (e.g. 20.00). NULL = no VAT treatment recorded. Display only — billing exports unchanged.';

-- da_email_sequences.template_key CHECK — add 'course_updated' -----------------
-- Same drop-and-recreate pattern as migration 028 (which this supersedes).

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
    'course_updated',
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
  'Email template identifier (migration 040). Canonical set = Kartra post-course journey + transactional (incl. course_updated) + billing keys; legacy interval keys retained. send-emails renders the matching template from supabase/functions/send-emails/templates.ts.';
