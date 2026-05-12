-- ============================================================
-- Daisy First Aid — Demo seed (v1)
--
-- Adds bookings/courses/customers/billing/activity to give the HQ
-- dashboard something to click through for the M1 demo.
--
-- Tagging (so the data can be removed cleanly when real bookings start):
--   * da_bookings.notes           contains  [seed:demo-v1]
--   * da_course_instances.bespoke_details  contains  [seed:demo-v1]
--   * da_customers.email          ends with @daisy-demo.local
--   * da_billing_runs.notes       contains  [seed:demo-v1]
--   * da_activities.metadata->>'demo_seed' = 'v1'
--   * da_ticket_types are removed by FK cascade when their parent instance dies
--
-- Targets the top 10 real franchisees by territory count (Hannah Allsop,
-- Gigi Jacob, Sarah Nixon, Feola McCandlish, Julie Rayson, Kirsty Crockett,
-- Lucy Read, Jules Charnley, Caroline Gardiner, Reka Voros).
--
-- Idempotent: re-running first wipes prior demo rows by tag, then re-seeds.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Teardown prior demo seed
-- ------------------------------------------------------------
DELETE FROM da_email_sequences
  WHERE booking_id IN (SELECT id FROM da_bookings WHERE notes LIKE '%[seed:demo-v1]%');
DELETE FROM da_bookings        WHERE notes LIKE '%[seed:demo-v1]%';
DELETE FROM da_ticket_types
  WHERE course_instance_id IN (
    SELECT id FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%'
  );
DELETE FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%';
DELETE FROM da_customers        WHERE email LIKE '%@daisy-demo.local';
DELETE FROM da_billing_runs     WHERE notes LIKE '%[seed:demo-v1]%';
DELETE FROM da_activities       WHERE metadata->>'demo_seed' = 'v1';

-- Deterministic randomness
SELECT setseed(0.42);

-- ------------------------------------------------------------
-- 2. Customers (40)
-- ------------------------------------------------------------
INSERT INTO da_customers (first_name, last_name, email, phone, postcode)
SELECT
  (ARRAY['Emily','Sophie','Charlotte','Olivia','Amelia','Isla','Ava','Mia','Grace','Lily',
         'Harper','Ella','Evie','Ruby','Daisy','Florence','Phoebe','Hazel','Ivy','Aria'])[1 + (s % 20)] AS first_name,
  (ARRAY['Smith','Jones','Williams','Brown','Taylor','Davies','Wilson','Evans','Thomas','Roberts',
         'Johnson','Walker','Wright','Robinson','Thompson','White','Hughes','Edwards','Green','Hall'])[1 + ((s / 3) % 20)] AS last_name,
  'demo-customer-' || s || '@daisy-demo.local',
  '07' || lpad(((s * 12345 + 100) % 1000000000)::text, 9, '0'),
  (ARRAY['SW11 2AA','NW1 3BB','EC1 4CC','M1 5DD','B1 6EE','LS1 7FF','BS1 8GG','NE1 9HH','CF1 0JJ','SO15 1KK'])[1 + (s % 10)]
FROM generate_series(1, 40) s;

-- ------------------------------------------------------------
-- 3. Course instances + ticket types + bookings + activity
--    All built inside one DO block so we can loop cleanly.
-- ------------------------------------------------------------
DO $$
DECLARE
  fr             RECORD;
  tpl_ids        UUID[];
  tpl_prices     INT[];
  tpl_caps       INT[];
  tpl_count      INT;
  inst_id        UUID;
  tk_id          UUID;
  cust_ids       UUID[];
  fr_idx         INT := 0;
  i              INT;
  j              INT;
  event_d        DATE;
  inst_status    TEXT;
  bk_count       INT;
  total_pence    INT;
  pay_status     TEXT;
  bk_status      TEXT;
  bk_created     TIMESTAMPTZ;
  reference      TEXT;
  next_seq       INT := 1;
  territory_id   UUID;
  postcode_pref  TEXT;
  month_offset   INT;
  bk_id          UUID;
  base_fee_pence INT;
  pct_pence      INT;
  charged_pence  INT;
  breakdown      JSONB;
  total_base     INT;
  total_pct      INT;
  total_due      INT;
  customer_id    UUID;
  customer_name  TEXT;
  customer_email TEXT;
BEGIN
  -- Load templates
  SELECT
    array_agg(id ORDER BY slug),
    array_agg(default_price_pence ORDER BY slug),
    array_agg(default_capacity ORDER BY slug)
  INTO tpl_ids, tpl_prices, tpl_caps
  FROM da_course_templates
  WHERE is_active = true;
  tpl_count := array_length(tpl_ids, 1);

  -- Load all demo customer ids (the 40 we just inserted)
  SELECT array_agg(id ORDER BY email)
  INTO cust_ids
  FROM da_customers
  WHERE email LIKE '%@daisy-demo.local';

  -- Loop the 10 target franchisees
  FOR fr IN
    SELECT
      f.id, f.number, f.name, f.fee_tier,
      (SELECT t.id FROM da_territories t WHERE t.franchisee_id = f.id ORDER BY t.postcode_prefix LIMIT 1) AS territory_id,
      (SELECT t.postcode_prefix FROM da_territories t WHERE t.franchisee_id = f.id ORDER BY t.postcode_prefix LIMIT 1) AS postcode_prefix
    FROM da_franchisees f
    WHERE f.is_hq = false
      AND f.status = 'active'
      AND EXISTS (SELECT 1 FROM da_territories t WHERE t.franchisee_id = f.id)
    ORDER BY (SELECT count(*) FROM da_territories t WHERE t.franchisee_id = f.id) DESC, f.number
    LIMIT 10
  LOOP
    fr_idx := fr_idx + 1;
    territory_id := fr.territory_id;
    postcode_pref := COALESCE(fr.postcode_prefix, 'SW1');

    -- 24 course instances per franchisee, one per month: Jun 2024 .. May 2026.
    -- 24 months supports the reports page Last-12-months / This-year-vs-last-year
    -- comparison views (each needs prior-year data to render the overlay).
    FOR month_offset IN -23..0 LOOP
      event_d := (DATE '2026-05-12' + (month_offset * INTERVAL '1 month') + ((fr_idx % 20) * INTERVAL '1 day'))::date;
      inst_status := CASE WHEN month_offset < 0 THEN 'completed' ELSE 'scheduled' END;

      i := 1 + ((fr_idx + month_offset + 100) % tpl_count);

      INSERT INTO da_course_instances
        (franchisee_id, template_id, territory_id, event_date, start_time, end_time,
         venue_name, venue_address, venue_postcode, visibility,
         capacity, spots_remaining, price_pence, bespoke_details, status)
      VALUES (
        fr.id, tpl_ids[i], territory_id, event_d, '10:00', '14:00',
        fr.name || ' venue ' || month_offset::text,
        postcode_pref || ' demo address',
        postcode_pref || ' 1AA',
        'public',
        tpl_caps[i],
        GREATEST(0, tpl_caps[i] - (3 + (fr_idx % 5))),
        tpl_prices[i],
        '[seed:demo-v1] auto-seeded for M1 demo',
        inst_status
      )
      RETURNING id INTO inst_id;

      INSERT INTO da_ticket_types (course_instance_id, name, price_pence, seats_consumed, sort_order)
      VALUES (inst_id, 'Single', tpl_prices[i], 1, 0)
      RETURNING id INTO tk_id;

      -- Bookings on this instance: 3 for past months, 2 for current
      bk_count := CASE WHEN month_offset < 0 THEN 3 ELSE 2 END;

      FOR j IN 1..bk_count LOOP
        customer_id := cust_ids[1 + ((fr_idx * 100 + (month_offset + 1000) * 10 + j) % array_length(cust_ids, 1))];

        SELECT first_name || ' ' || last_name, email
        INTO customer_name, customer_email
        FROM da_customers WHERE id = customer_id;

        -- Booking ref following the live format: DA-YYYY-NNNNN-S<seq>
        reference := 'DA-' || extract(year FROM event_d)::text || '-'
                     || lpad(fr.number, 5, '0') || '-D' || next_seq::text;
        next_seq := next_seq + 1;

        bk_created := event_d::timestamptz - (((j % 14) + 1) * INTERVAL '1 day');

        -- Status mix: ~70% paid, ~15% manual, ~10% pending, ~5% refunded
        pay_status := CASE
          WHEN j = 1 AND month_offset < 0 THEN 'paid'
          WHEN j = 2 THEN (CASE WHEN month_offset < -2 THEN 'paid' ELSE 'manual' END)
          WHEN j = 3 AND month_offset = -1 THEN 'pending'
          ELSE 'paid'
        END;

        bk_status := CASE
          WHEN month_offset < 0 AND j = 1 THEN 'attended'
          WHEN month_offset < 0 AND j = 2 THEN 'attended'
          WHEN month_offset < 0 AND j = 3 THEN 'no_show'
          ELSE 'confirmed'
        END;

        total_pence := tpl_prices[i];

        INSERT INTO da_bookings
          (booking_reference, course_instance_id, franchisee_id, customer_id, ticket_type_id,
           quantity, total_price_pence, payment_status, booking_status,
           notes, created_at)
        VALUES (
          reference, inst_id, fr.id, customer_id, tk_id,
          1, total_pence, pay_status, bk_status,
          'Demo booking [seed:demo-v1]', bk_created
        )
        RETURNING id INTO bk_id;

        -- Activity row per booking
        INSERT INTO da_activities (actor_type, actor_id, entity_type, entity_id, action, metadata, description, created_at)
        VALUES (
          'system', NULL, 'booking', bk_id, 'booking_created',
          jsonb_build_object('demo_seed', 'v1', 'reference', reference, 'amount_pence', total_pence, 'franchisee_id', fr.id),
          'Booking ' || reference || ' from ' || customer_name || ' (' || pay_status || ')',
          bk_created + INTERVAL '1 minute'
        );
      END LOOP;

      -- Activity row per course instance
      INSERT INTO da_activities (actor_type, actor_id, entity_type, entity_id, action, metadata, description, created_at)
      VALUES (
        'franchisee', fr.id, 'course_instance', inst_id, 'course_created',
        jsonb_build_object('demo_seed', 'v1', 'template_id', tpl_ids[i], 'franchisee_name', fr.name),
        fr.name || ' scheduled a course at ' || postcode_pref || ' on ' || to_char(event_d, 'DD Mon YYYY'),
        (event_d::timestamptz - INTERVAL '10 days')
      );
    END LOOP;

    -- ----------------------------------------------------------
    -- Billing run for April 2026 period (event_dates in April 2026)
    -- ----------------------------------------------------------
    base_fee_pence := fr.fee_tier * 100;  -- fee_tier is £ (e.g. 100 = £100), convert to pence

    -- Revenue this franchisee earned across the April period (against demo bookings)
    SELECT COALESCE(SUM(b.total_price_pence), 0)
    INTO total_pence
    FROM da_bookings b
    JOIN da_course_instances ci ON ci.id = b.course_instance_id
    WHERE b.franchisee_id = fr.id
      AND ci.event_date >= DATE '2026-04-01'
      AND ci.event_date <  DATE '2026-05-01'
      AND b.payment_status IN ('paid', 'manual')
      AND b.booking_status != 'cancelled'
      AND b.notes LIKE '%[seed:demo-v1]%';

    pct_pence := FLOOR(total_pence * 0.10);
    charged_pence := GREATEST(base_fee_pence, pct_pence);

    breakdown := jsonb_build_array(jsonb_build_object(
      'territory_id', territory_id,
      'postcode_prefix', postcode_pref,
      'territory_name', postcode_pref,
      'base_fee_pence', base_fee_pence,
      'revenue_pence', total_pence,
      'percentage_fee_pence', pct_pence,
      'fee_charged_pence', charged_pence,
      'logic', CASE WHEN base_fee_pence >= pct_pence THEN 'base_fee_wins' ELSE 'percentage_wins' END
    ));

    INSERT INTO da_billing_runs
      (franchisee_id, billing_period_start, billing_period_end,
       territory_breakdown, total_base_fees_pence, total_percentage_fees_pence, total_due_pence,
       payment_status, notes, created_at, paid_at)
    VALUES (
      fr.id, DATE '2026-04-01', DATE '2026-04-30',
      breakdown, base_fee_pence, pct_pence, charged_pence,
      CASE WHEN fr_idx > 8 THEN 'failed' ELSE 'paid' END,
      'Auto-generated demo run [seed:demo-v1]',
      TIMESTAMPTZ '2026-05-01 06:00:00+00',
      CASE WHEN fr_idx > 8 THEN NULL ELSE TIMESTAMPTZ '2026-05-02 12:00:00+00' END
    );

    -- Activity row for the billing run
    INSERT INTO da_activities (actor_type, actor_id, entity_type, entity_id, action, metadata, description, created_at)
    VALUES (
      'system', NULL, 'billing_run', fr.id, 'billing_run_created',
      jsonb_build_object('demo_seed', 'v1', 'period', '2026-04', 'amount_pence', charged_pence),
      'Billing run for ' || fr.name || ' — £' || to_char(charged_pence / 100.0, 'FM999990.00') || ' (April)',
      TIMESTAMPTZ '2026-05-01 06:00:00+00'
    );
  END LOOP;
END$$;

COMMIT;

-- Quick verification view
SELECT
  (SELECT count(*) FROM da_bookings WHERE notes LIKE '%[seed:demo-v1]%') AS demo_bookings,
  (SELECT count(*) FROM da_course_instances WHERE bespoke_details LIKE '%[seed:demo-v1]%') AS demo_instances,
  (SELECT count(*) FROM da_customers WHERE email LIKE '%@daisy-demo.local') AS demo_customers,
  (SELECT count(*) FROM da_billing_runs WHERE notes LIKE '%[seed:demo-v1]%') AS demo_billing,
  (SELECT count(*) FROM da_activities WHERE metadata->>'demo_seed' = 'v1') AS demo_activities;
