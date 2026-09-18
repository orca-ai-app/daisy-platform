-- 058: capture where a private (home/workplace) class is actually delivered.
--
-- Private classes are booked at the customer's own address, but the booking
-- flow only ever captured name, email, phone and postcode. So a trainer taking
-- a home or workplace booking had no address to travel to and no parking or
-- access detail (Jenni, 18 Sep 2026). These two columns hold that, supplied by
-- the customer at checkout on private bookings and shown to the trainer on the
-- booking alert email and in the portal.
--
-- Both are nullable and stay null for public venue classes, where the customer
-- travels to a fixed venue and no address is needed.

ALTER TABLE da_bookings
  ADD COLUMN service_address TEXT,
  ADD COLUMN parking_notes   TEXT;

COMMENT ON COLUMN da_bookings.service_address IS
  'Customer-supplied address where a private/home/workplace class is delivered (migration 058). Null for public venue classes.';
COMMENT ON COLUMN da_bookings.parking_notes IS
  'Optional parking or access notes for a private class, shown to the trainer (migration 058).';
