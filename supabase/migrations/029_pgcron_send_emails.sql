-- 029_pgcron_send_emails.sql
-- M3 Wave 13. Schedules the hourly send-emails drainer. pg_cron fires every hour
-- and uses pg_net to POST the send-emails Edge Function, authenticating with the
-- CRON_SECRET. PRD §5.6.
--
-- SECRET HANDLING: the CRON_SECRET is NOT in this file. It lives in Supabase
-- Vault under the name `cron_secret_send_emails` (created out-of-band, never
-- committed) and is read at call time via vault.decrypted_secrets. Before this
-- migration runs, create that vault secret with the same value as the
-- send-emails function's CRON_SECRET env:
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret_send_emails');
--
-- Requires pg_cron + pg_net (enabled separately). Idempotent.
--
-- This is migration 029 — do NOT renumber.

DO $$
DECLARE jid BIGINT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'send-emails-hourly';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'send-emails-hourly',
  '0 * * * *',
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
