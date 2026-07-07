-- 035_system_logs_and_reservations.sql
-- Full-project review remediation (2026-07-07):
--   1. da_system_logs — the debugging log every edge function and all three
--      frontends write to (browser errors arrive via log-client-event).
--      da_activities stays the BUSINESS audit trail; this is the DEBUG trail.
--   2. reserve_spots/release_spots — spots are now held atomically when a
--      Stripe Checkout session is created (create-checkout-session), not
--      decremented after payment (stripe-webhook), closing the overbooking
--      race. Stale pending bookings release their holds via the hourly sweep
--      in send-emails.
--
-- This is migration 035 — do NOT renumber.

-- da_system_logs ----------------------------------------------------------------

CREATE TABLE da_system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  -- Edge function name, or 'browser:portal' | 'browser:booking' | 'browser:medical'.
  source TEXT NOT NULL,
  -- Short hex id generated per request; shown to users in error messages
  -- ("ref 3f9c2a") so a support report maps straight to rows here.
  request_id TEXT,
  actor TEXT,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  context JSONB
);

CREATE INDEX idx_system_logs_created ON da_system_logs (created_at DESC);
CREATE INDEX idx_system_logs_level ON da_system_logs (level, created_at DESC);
CREATE INDEX idx_system_logs_request ON da_system_logs (request_id);
CREATE INDEX idx_system_logs_source ON da_system_logs (source, created_at DESC);

ALTER TABLE da_system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_read" ON da_system_logs
  FOR SELECT USING (is_hq_user());
-- Writes: service role only (edge functions + log-client-event).

-- Retention: purge rows older than 60 days, daily at 02:30 UTC.
SELECT cron.schedule(
  'purge-system-logs-daily',
  '30 2 * * *',
  $$DELETE FROM da_system_logs WHERE created_at < NOW() - INTERVAL '60 days'$$
);

-- reserve_spots / release_spots ---------------------------------------------------
-- Conditional atomic hold; single-statement UPDATE so concurrent checkouts for
-- the last spot cannot both succeed. Returns true when the hold was taken.

CREATE OR REPLACE FUNCTION reserve_spots(instance_id UUID, seats INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  updated INTEGER;
BEGIN
  IF seats IS NULL OR seats <= 0 THEN
    RETURN FALSE;
  END IF;
  UPDATE da_course_instances
  SET spots_remaining = spots_remaining - seats
  WHERE id = instance_id
    AND spots_remaining >= seats;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END;
$$;

-- Releases a hold (abandoned/expired pending booking). Clamped to capacity so
-- a double release can never inflate availability.
CREATE OR REPLACE FUNCTION release_spots(instance_id UUID, seats INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF seats IS NULL OR seats <= 0 THEN
    RETURN;
  END IF;
  UPDATE da_course_instances
  SET spots_remaining = LEAST(capacity, spots_remaining + seats)
  WHERE id = instance_id;
END;
$$;

COMMENT ON FUNCTION reserve_spots(UUID, INTEGER) IS
  'Atomic conditional hold at checkout-session creation (migration 035). Replaces decrement-at-webhook.';
COMMENT ON FUNCTION release_spots(UUID, INTEGER) IS
  'Releases a reservation from an expired/cancelled pending booking (migration 035). Capacity-clamped.';

-- Track how many seats a pending booking is holding, so the expiry sweep and
-- the webhook release/confirm exactly what was reserved.
ALTER TABLE da_bookings
  ADD COLUMN reserved_seats INTEGER;

COMMENT ON COLUMN da_bookings.reserved_seats IS
  'Seats held by reserve_spots() when this booking was created pending (migration 035). NULL for pre-035 rows and non-checkout bookings.';
