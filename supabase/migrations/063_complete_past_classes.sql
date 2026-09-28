-- 063: mark classes that have run as 'completed', nightly.
--
-- Nothing ever moved a class from 'scheduled' to 'completed' (no cron, no
-- button), so past classes kept showing as "Scheduled" in the portal and the
-- Status filter's "Completed" option matched nothing (TRI-0022, TRI-0025).
-- A class counts as run once its date is before today in Europe/London. Only
-- 'scheduled' rows move; cancelled classes stay cancelled. Today's classes are
-- untouched, so the medical form (which resolves today's class) is unaffected.
-- Add booking still lists classes completed in the last 30 days.

UPDATE da_course_instances
SET status = 'completed', updated_at = now()
WHERE status = 'scheduled'
  AND event_date < (now() AT TIME ZONE 'Europe/London')::date;

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'complete-past-classes';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

-- 00:10 UTC = 00:10 or 01:10 London, always after local midnight.
SELECT cron.schedule(
  'complete-past-classes',
  '10 0 * * *',
  $job$
    UPDATE da_course_instances
    SET status = 'completed', updated_at = now()
    WHERE status = 'scheduled'
      AND event_date < (now() AT TIME ZONE 'Europe/London')::date;
  $job$
);
