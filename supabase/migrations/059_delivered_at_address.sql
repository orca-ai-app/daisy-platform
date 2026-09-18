-- 059: mark a class as delivered at the customer's own address (home/workplace).
--
-- Migration 058 started capturing the customer's address, but only for PRIVATE
-- bookings (gated on visibility='private'). Franchisees also list home classes
-- PUBLICLY, with just the advertised area as an outcode (e.g. SM1) rather than a
-- fixed venue — a customer books through public search and the class runs at
-- THEIR address (Jenni, 18 Sep 2026). Those bookings still need an address, but
-- visibility='public' meant the flow never asked for one.
--
-- visibility (public/private) is about who can find and book the class; it is
-- the wrong axis for "where does it happen". This adds an explicit flag so the
-- booking flow asks the customer for their address whenever the class is
-- delivered at that address, on the public flow as well as the private one.
--
-- Every existing private class is delivered at the customer's address, so those
-- are backfilled TRUE to keep behaviour identical. Public classes stay FALSE
-- (fixed venue) until a franchisee ticks the box on a home class.

ALTER TABLE da_course_instances
  ADD COLUMN delivered_at_address BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE da_course_instances
  SET delivered_at_address = TRUE
  WHERE visibility = 'private';

COMMENT ON COLUMN da_course_instances.delivered_at_address IS
  'TRUE when the class runs at the customer''s own address (home/workplace), so the booking flow asks the customer for their address + parking (migration 059). Always true for private classes; opt-in for public home classes where venue_postcode is only the advertised area. Drives the address requirement in create-checkout-session alongside visibility.';
