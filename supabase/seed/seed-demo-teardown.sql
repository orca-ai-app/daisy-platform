-- ============================================================
-- Daisy First Aid — Demo seed (v1) teardown
--
-- Removes every row that seed-demo.sql inserted, in FK-safe order.
-- Safe to run on production when real bookings start landing — it
-- only deletes rows that carry the [seed:demo-v1] tag (or the
-- @daisy-demo.local email pattern for customers).
--
-- All five DELETE statements use a tag predicate. Anything written
-- by HQ portal usage, franchisee actions, or future real flows is
-- untouched because none of those write the [seed:demo-v1] marker.
--
-- Re-runnable. Wraps in a single transaction so partial failure
-- rolls back cleanly.
-- ============================================================

BEGIN;

-- Snapshot counts before
CREATE TEMP TABLE _td_before AS
SELECT
  (SELECT count(*) FROM da_bookings        WHERE notes LIKE '%[seed:demo-v1]%')             AS demo_bookings,
  (SELECT count(*) FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%')   AS demo_instances,
  (SELECT count(*) FROM da_customers       WHERE email LIKE '%@daisy-demo.local')            AS demo_customers,
  (SELECT count(*) FROM da_billing_runs    WHERE notes LIKE '%[seed:demo-v1]%')              AS demo_billing,
  (SELECT count(*) FROM da_activities      WHERE metadata->>'demo_seed' = 'v1')              AS demo_activities,
  (SELECT count(*) FROM da_ticket_types tt WHERE tt.course_instance_id IN (
    SELECT id FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%'
  ))                                                                                          AS demo_ticket_types,
  (SELECT count(*) FROM da_email_sequences es WHERE es.booking_id IN (
    SELECT id FROM da_bookings WHERE notes LIKE '%[seed:demo-v1]%'
  ))                                                                                          AS demo_email_sequences;

-- FK-safe delete order
DELETE FROM da_email_sequences
  WHERE booking_id IN (SELECT id FROM da_bookings WHERE notes LIKE '%[seed:demo-v1]%');
DELETE FROM da_bookings         WHERE notes LIKE '%[seed:demo-v1]%';
DELETE FROM da_ticket_types
  WHERE course_instance_id IN (
    SELECT id FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%'
  );
DELETE FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%';
DELETE FROM da_customers        WHERE email LIKE '%@daisy-demo.local';
DELETE FROM da_billing_runs     WHERE notes LIKE '%[seed:demo-v1]%';
DELETE FROM da_activities       WHERE metadata->>'demo_seed' = 'v1';

-- Verify no residual demo rows
SELECT
  b.demo_bookings        AS removed_bookings,
  b.demo_instances       AS removed_instances,
  b.demo_customers       AS removed_customers,
  b.demo_billing         AS removed_billing,
  b.demo_activities      AS removed_activities,
  b.demo_ticket_types    AS removed_ticket_types,
  b.demo_email_sequences AS removed_email_sequences,
  (SELECT count(*) FROM da_bookings WHERE notes LIKE '%[seed:demo-v1]%')             AS residual_bookings,
  (SELECT count(*) FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%') AS residual_instances,
  (SELECT count(*) FROM da_customers WHERE email LIKE '%@daisy-demo.local')          AS residual_customers,
  (SELECT count(*) FROM da_billing_runs WHERE notes LIKE '%[seed:demo-v1]%')         AS residual_billing,
  (SELECT count(*) FROM da_activities WHERE metadata->>'demo_seed' = 'v1')           AS residual_activities
FROM _td_before b;

COMMIT;
