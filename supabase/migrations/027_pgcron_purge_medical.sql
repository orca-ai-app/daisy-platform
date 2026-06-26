-- 027_pgcron_purge_medical.sql
-- M3 Wave 12. Schedules the nightly GDPR retention purge of medical declarations
-- as a direct pg_cron SQL job (02:00 UTC). PRD §5.7.
--
-- Done in SQL (not via the edge function) so the destructive delete stays in the
-- database with no cron→function auth handshake. The purge-medical-declarations
-- edge function remains as the HQ "purge now" manual trigger.
--
-- Requires pg_cron (enabled separately). Idempotent: unschedules any existing
-- job of the same name before (re)scheduling.
--
-- This is migration 027 — do NOT renumber.

-- Remove a prior definition if this migration is re-run.
DO $$
DECLARE jid BIGINT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'purge-medical-declarations';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'purge-medical-declarations',
  '0 2 * * *',
  $job$
    WITH deleted AS (
      DELETE FROM da_medical_declarations
      WHERE gdpr_retention_expires_at < NOW()
        AND consent_given = TRUE
      RETURNING id
    ), n AS (SELECT count(*) AS c FROM deleted)
    INSERT INTO da_activities
      (actor_type, actor_id, entity_type, entity_id, action, metadata, description)
    SELECT 'system', NULL, 'medical_declaration', gen_random_uuid(),
           'medical_declarations_purged',
           jsonb_build_object('count', n.c, 'scheduled', true),
           'Nightly GDPR purge: removed ' || n.c || ' expired medical declaration(s)'
    FROM n
    WHERE n.c > 0;
  $job$
);
