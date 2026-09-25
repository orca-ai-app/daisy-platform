-- 062: drain the email queue every 5 minutes instead of hourly.
--
-- Booking confirmations are queued with scheduled_for = now() and sent by the
-- send-emails cron, which ran at the top of every hour (migration 029). A
-- customer who booked at 10:01 waited until 11:00 for the confirmation while
-- the Stripe receipt arrived instantly (Julie, 25 Sep 2026). Five minutes is
-- the right cadence for a transactional email; an empty run is a cheap
-- no-op (the function pages through due rows and returns).

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'send-emails-hourly';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'send-emails-every-5-min',
  '*/5 * * * *',
  $job$
    SELECT net.http_post(
      url     := 'https://dmvajkreuwknjqxyxmlv.supabase.co/functions/v1/send-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'cron_secret_send_emails'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
