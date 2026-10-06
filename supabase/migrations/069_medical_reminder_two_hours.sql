-- 069: "Your class is soon" email two hours before the class, not one
-- (TRI-0048, Jemma; approved by Jenni 5 Oct 2026, October batch A1).
--
-- New bookings get the new time from _shared/emailSchedule.ts
-- (MEDICAL_REMINDER_HOURS_BEFORE = 2). This moves the medical_reminder rows
-- that were queued under the old one-hour rule and have not sent yet.
--
-- Idempotent: the new time is computed from the class's CURRENT start
-- (Europe/London wall clock, GMT/BST-safe, same expression as migration 061),
-- never by shifting the stored time, so running this twice cannot move a row
-- twice. It also realigns the few rows whose class was re-dated after booking.
--
-- Only touches pending rows whose class has not started yet:
--   * start − 2h still ahead  -> scheduled for start − 2h
--   * start − 2h already past -> scheduled for now(), so the next send-emails
--                                run (every 5 min) sends it before the class
-- Rows for classes that have already started are left alone. Cancelled
-- bookings or classes are still caught by send-emails' lifecycle gate.

WITH target AS (
  SELECT
    s.id,
    (((ci.event_date::text || ' ' || COALESCE(ci.start_time::text, '00:00:00'))::timestamp)
       AT TIME ZONE 'Europe/London') AS class_start
  FROM da_email_sequences s
  JOIN da_bookings b ON b.id = s.booking_id
  JOIN da_course_instances ci ON ci.id = b.course_instance_id
  WHERE s.template_key = 'medical_reminder'
    AND s.status = 'pending'
)
UPDATE da_email_sequences s
SET scheduled_for = GREATEST(t.class_start - interval '2 hours', now())
FROM target t
WHERE s.id = t.id
  AND t.class_start > now()
  AND s.scheduled_for IS DISTINCT FROM GREATEST(t.class_start - interval '2 hours', now());
