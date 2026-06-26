-- 026_booking_token.sql
-- M3 Wave 11. Adds da_course_instances.booking_token: a short, URL-safe, unique
-- slug used by the public standalone booking page (booking.daisyfirstaid.com/book/:token).
-- The token resolves a course without exposing internal UUIDs, and replaces the
-- M2 raw Stripe Payment Link as the private-booking share URL.
--
-- Every instance gets a token (DEFAULT), so any course is shareable. 16 hex chars
-- from md5(random()+clock_timestamp) — no pgcrypto dependency.
--
-- This is migration 026 — do NOT renumber.

ALTER TABLE da_course_instances
  ADD COLUMN booking_token TEXT;

-- Backfill existing rows with distinct tokens.
UPDATE da_course_instances
  SET booking_token = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 16)
  WHERE booking_token IS NULL;

ALTER TABLE da_course_instances
  ALTER COLUMN booking_token SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  ALTER COLUMN booking_token SET NOT NULL,
  ADD CONSTRAINT da_course_instances_booking_token_key UNIQUE (booking_token);

COMMENT ON COLUMN da_course_instances.booking_token IS
  'URL-safe slug for the public standalone booking page (/book/:token). Set automatically; resolves a course without exposing its UUID. M3 replacement for the M2 stripe_payment_link.';
