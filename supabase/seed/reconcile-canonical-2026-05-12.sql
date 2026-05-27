-- ============================================================
-- Franchisee list reconciliation against canonical (2026-05-12)
-- Source: 'client provided' tab of franchisee-territory-postcodes.xlsx
-- Tagged: metadata->>'reconciliation' = 'canonical-2026-05-12'
-- ============================================================

BEGIN;

CREATE TEMP TABLE _before AS
SELECT
  (SELECT count(*) FROM da_franchisees WHERE status='active' AND is_hq=false) AS active_franchisees,
  (SELECT count(*) FROM da_franchisees WHERE status='terminated') AS terminated_franchisees,
  (SELECT count(DISTINCT territory_number) FROM da_territories WHERE status='active') AS active_territories,
  (SELECT count(DISTINCT territory_number) FROM da_territories WHERE status='vacant') AS vacant_territories;

DO $$
DECLARE
  jemma          UUID;
  kay            UUID;
  claire_katy    UUID;
  farah          UUID;
  sarah_b        UUID;
  judith         UUID;
  fay            UUID;
  jude           UUID;
  sarah_rd       UUID;
  ashleigh       UUID;
  vacant_holder  UUID := 'd1f1aaaa-0000-4000-8000-000000000001';  -- Jenni HQ id (existing convention)
  tag            TEXT := 'canonical-2026-05-12';
BEGIN
  SELECT id INTO jemma        FROM da_franchisees WHERE number = '0002';
  SELECT id INTO kay          FROM da_franchisees WHERE number = '0023';
  SELECT id INTO claire_katy  FROM da_franchisees WHERE number = '0068';
  SELECT id INTO farah        FROM da_franchisees WHERE number = '0089';
  SELECT id INTO sarah_b      FROM da_franchisees WHERE number = '0183';
  SELECT id INTO judith       FROM da_franchisees WHERE number = '0235';
  SELECT id INTO fay          FROM da_franchisees WHERE number = '0245';
  SELECT id INTO jude         FROM da_franchisees WHERE number = '0072';
  SELECT id INTO sarah_rd     FROM da_franchisees WHERE number = '0029';

  -- 1. Terminate 4 franchisees absent from canonical list
  UPDATE da_franchisees
     SET status = 'terminated',
         notes  = COALESCE(notes || E'\n', '') || '[reconciliation:' || tag || '] Absent from canonical client list',
         updated_at = NOW()
   WHERE id IN (kay, claire_katy, farah, sarah_b);

  -- 2. Spelling fix
  UPDATE da_franchisees
     SET name = 'Sarah Russell-Davis',
         updated_at = NOW()
   WHERE id = sarah_rd;

  -- 3. Jemma reassignment
  UPDATE da_territories
     SET franchisee_id = vacant_holder, status = 'vacant', updated_at = NOW()
   WHERE territory_number = 2;
  UPDATE da_territories
     SET franchisee_id = jemma, status = 'active', updated_at = NOW()
   WHERE territory_number = 23;
  UPDATE da_territories
     SET franchisee_id = jemma, status = 'active', name = 'Winchester', updated_at = NOW()
   WHERE territory_number = 26;

  -- 4. #68 Kensington → Jude Sharkey
  UPDATE da_territories
     SET franchisee_id = jude, status = 'active', updated_at = NOW()
   WHERE territory_number = 68;

  -- 5. Vacate #89 + #183
  UPDATE da_territories
     SET franchisee_id = vacant_holder, status = 'vacant', updated_at = NOW()
   WHERE territory_number IN (89, 183);

  -- 6. #242 → Fay Cartlidge, rename to Ilkley
  UPDATE da_territories
     SET franchisee_id = fay, status = 'active', name = 'Ilkley', updated_at = NOW()
   WHERE territory_number = 242;

  -- 7. Onboard Ashleigh Clarke + assign #25 Eastleigh
  INSERT INTO da_franchisees (number, name, email, is_hq, status, fee_tier, billing_date, notes)
  VALUES ('0025', 'Ashleigh Clarke', 'ashleigh@daisyfirstaid.com', false, 'active', 100, 28,
          '[reconciliation:' || tag || '] Onboarded from canonical client list')
  RETURNING id INTO ashleigh;

  UPDATE da_territories
     SET franchisee_id = ashleigh, status = 'active', name = 'Eastleigh', updated_at = NOW()
   WHERE territory_number = 25;

  -- 8. Activity log — one row per change, all tagged for traceability
  INSERT INTO da_activities (actor_type, entity_type, entity_id, action, metadata, description) VALUES
    ('hq', 'franchisee', kay,         'franchisee_terminated',  jsonb_build_object('reconciliation', tag), 'Kay Hird terminated -- absent from canonical client list'),
    ('hq', 'franchisee', claire_katy, 'franchisee_terminated',  jsonb_build_object('reconciliation', tag), 'Claire & Katy terminated -- absent from canonical client list'),
    ('hq', 'franchisee', farah,       'franchisee_terminated',  jsonb_build_object('reconciliation', tag), 'Farah Hulkorey terminated -- absent from canonical client list'),
    ('hq', 'franchisee', sarah_b,     'franchisee_terminated',  jsonb_build_object('reconciliation', tag), 'Sarah Barnes terminated -- absent from canonical client list'),
    ('hq', 'franchisee', sarah_rd,    'franchisee_renamed',     jsonb_build_object('reconciliation', tag, 'from', 'Sarah Russel-Davis', 'to', 'Sarah Russell-Davis'), 'Sarah Russell-Davis: spelling corrected per canonical list'),
    ('hq', 'franchisee', jemma,       'territories_reassigned', jsonb_build_object('reconciliation', tag, 'added', ARRAY[23, 26], 'removed', ARRAY[2]), 'Jemma Hoare reassigned: vacated #2 Central Cornwall, took #23 Gosport & Fareham and #26 Winchester'),
    ('hq', 'franchisee', jude,        'territories_reassigned', jsonb_build_object('reconciliation', tag, 'added', ARRAY[68]), 'Jude Sharkey: took #68 Kensington (previously Claire & Katy)'),
    ('hq', 'franchisee', fay,         'territories_reassigned', jsonb_build_object('reconciliation', tag, 'added', ARRAY[242], 'renamed', 'Harrogate -> Ilkley'), 'Fay Cartlidge: took #242 (renamed Harrogate to Ilkley, previously Judith Carlton)'),
    ('hq', 'franchisee', ashleigh,    'franchisee_created',     jsonb_build_object('reconciliation', tag), 'Ashleigh Clarke onboarded with #25 Eastleigh');
END$$;

-- Snapshot after
SELECT
  b.active_franchisees      AS active_before,
  (SELECT count(*) FROM da_franchisees WHERE status='active' AND is_hq=false) AS active_after,
  b.terminated_franchisees  AS terminated_before,
  (SELECT count(*) FROM da_franchisees WHERE status='terminated') AS terminated_after,
  b.active_territories      AS active_terr_before,
  (SELECT count(DISTINCT territory_number) FROM da_territories WHERE status='active') AS active_terr_after,
  b.vacant_territories      AS vacant_terr_before,
  (SELECT count(DISTINCT territory_number) FROM da_territories WHERE status='vacant') AS vacant_terr_after,
  (SELECT count(*) FROM da_activities WHERE metadata->>'reconciliation' = 'canonical-2026-05-12') AS activity_rows_logged
FROM _before b;

COMMIT;
