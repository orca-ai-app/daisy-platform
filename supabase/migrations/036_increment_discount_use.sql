-- 036_increment_discount_use.sql
-- Atomic discount-use counter. Replaces the read-modify-write in stripe-webhook
-- which could lose increments under concurrent webhook deliveries, letting
-- max-use codes over-redeem.
--
-- This is migration 036 — do NOT renumber.

CREATE OR REPLACE FUNCTION increment_discount_use(discount_code TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE da_discount_codes
  SET uses_count = uses_count + 1
  WHERE code = discount_code;
$$;

COMMENT ON FUNCTION increment_discount_use(TEXT) IS
  'Single-statement atomic uses_count bump (migration 036). Called by stripe-webhook on booking finalise.';
