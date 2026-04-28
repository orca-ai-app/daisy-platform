-- 008_helper_functions.sql
-- Helper functions: get_current_franchisee_id, is_hq_user, decrement_spots,
-- find_nearest_courses, next_booking_reference.
-- Plus the global da_bookings_seq SEQUENCE (M1 plan §3 decision).
-- References: PRD §4.5, §4.9, §4.18, §5.2 and M1 plan §3.

-- da_bookings_seq -------------------------------------------------------------
-- Single global sequence, reset January 1 each year by next_booking_reference()
-- (sequences themselves don't auto-reset — we reset on first call of a new year).

CREATE SEQUENCE IF NOT EXISTS da_bookings_seq START 1 INCREMENT 1 MINVALUE 1;

-- get_current_franchisee_id ---------------------------------------------------
-- PRD §4.18.

CREATE OR REPLACE FUNCTION get_current_franchisee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM da_franchisees WHERE auth_user_id = auth.uid()
$$;

-- is_hq_user ------------------------------------------------------------------
-- PRD §4.18.

CREATE OR REPLACE FUNCTION is_hq_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_hq FROM da_franchisees WHERE auth_user_id = auth.uid()),
    FALSE
  )
$$;

-- decrement_spots -------------------------------------------------------------
-- PRD §4.5. Atomic spots_remaining decrement with FOR UPDATE row lock.

CREATE OR REPLACE FUNCTION decrement_spots(instance_id UUID, seats INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  current_spots INTEGER;
BEGIN
  SELECT spots_remaining INTO current_spots
  FROM da_course_instances
  WHERE id = instance_id
  FOR UPDATE;

  IF current_spots IS NULL THEN
    RETURN FALSE;
  END IF;

  IF current_spots >= seats THEN
    UPDATE da_course_instances
    SET spots_remaining = spots_remaining - seats,
        updated_at = NOW()
    WHERE id = instance_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- find_nearest_courses --------------------------------------------------------
-- PRD §5.2. PostGIS ST_DWithin within radius_miles. Returns one row per
-- course_instance + ticket_type combination (ticket_types aggregated to JSON).
-- Joins course_instances, course_templates, franchisees, ticket_types.
--
-- Distance: ST_Distance on geography(Point) returns metres. 1 mile = 1609.344m.

CREATE OR REPLACE FUNCTION find_nearest_courses(
  search_lat    DOUBLE PRECISION,
  search_lng    DOUBLE PRECISION,
  radius_miles  INTEGER
)
RETURNS TABLE (
  id              UUID,
  template_id     UUID,
  template_name   TEXT,
  template_slug   TEXT,
  franchisee_id   UUID,
  franchisee_name TEXT,
  event_date      DATE,
  start_time      TIME,
  end_time        TIME,
  venue_name      TEXT,
  venue_postcode  TEXT,
  capacity        INTEGER,
  spots_remaining INTEGER,
  price_pence     INTEGER,
  status          TEXT,
  visibility      TEXT,
  distance_miles  DOUBLE PRECISION,
  ticket_types    JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH search_point AS (
    SELECT ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography AS g
  )
  SELECT
    ci.id,
    ci.template_id,
    ct.name           AS template_name,
    ct.slug           AS template_slug,
    ci.franchisee_id,
    f.name            AS franchisee_name,
    ci.event_date,
    ci.start_time,
    ci.end_time,
    ci.venue_name,
    ci.venue_postcode,
    ci.capacity,
    ci.spots_remaining,
    ci.price_pence,
    ci.status,
    ci.visibility,
    ST_Distance(ci.geom::geography, sp.g) / 1609.344 AS distance_miles,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',             tt.id,
            'name',           tt.name,
            'price_pence',    tt.price_pence,
            'seats_consumed', tt.seats_consumed,
            'max_available',  tt.max_available,
            'sort_order',     tt.sort_order
          )
          ORDER BY tt.sort_order, tt.name
        )
        FROM da_ticket_types tt
        WHERE tt.course_instance_id = ci.id
      ),
      '[]'::jsonb
    )                  AS ticket_types
  FROM da_course_instances ci
  JOIN da_course_templates ct ON ct.id = ci.template_id
  JOIN da_franchisees      f  ON f.id  = ci.franchisee_id
  CROSS JOIN search_point sp
  WHERE ci.geom IS NOT NULL
    AND ci.status = 'scheduled'
    AND ci.visibility = 'public'
    AND ci.spots_remaining > 0
    AND ci.event_date >= CURRENT_DATE
    AND ST_DWithin(ci.geom::geography, sp.g, radius_miles * 1609.344)
  ORDER BY distance_miles ASC, ci.event_date ASC;
$$;

-- next_booking_reference ------------------------------------------------------
-- Format: DA-{YYYY}-{franchisee_number:5}-{seq}
-- Single global sequence; resets to 1 on first call each calendar year.
-- We track the "year of last issue" in da_settings so a same-year second call
-- continues incrementing, while a January call rolls over to 1.

CREATE OR REPLACE FUNCTION next_booking_reference(franchisee_number VARCHAR)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  current_year       INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  stored_year_text   TEXT;
  stored_year        INTEGER;
  next_seq           BIGINT;
  padded_number      TEXT;
BEGIN
  IF franchisee_number IS NULL OR length(franchisee_number) = 0 THEN
    RAISE EXCEPTION 'franchisee_number is required';
  END IF;

  -- Lookup-or-create the year tracker row. Lock it so concurrent callers
  -- don't both reset the sequence.
  SELECT value INTO stored_year_text
  FROM da_settings
  WHERE key = 'da_bookings_seq_year'
  FOR UPDATE;

  IF stored_year_text IS NULL THEN
    INSERT INTO da_settings (key, value, description)
    VALUES (
      'da_bookings_seq_year',
      current_year::TEXT,
      'Internal: tracks the year the global da_bookings_seq sequence is in. Reset to 1 on first call of a new year.'
    )
    ON CONFLICT (key) DO NOTHING;
    stored_year := current_year;
  ELSE
    stored_year := stored_year_text::INTEGER;
  END IF;

  IF stored_year <> current_year THEN
    -- New year — reset sequence and update tracker.
    PERFORM setval('da_bookings_seq', 1, FALSE);
    UPDATE da_settings
    SET value = current_year::TEXT, updated_at = NOW()
    WHERE key = 'da_bookings_seq_year';
  END IF;

  next_seq := nextval('da_bookings_seq');

  -- Pad VARCHAR(4) franchisee number to 5 chars per PRD §4.9 ("padded to 5 digits").
  padded_number := lpad(franchisee_number, 5, '0');

  RETURN format('DA-%s-%s-%s', current_year::TEXT, padded_number, next_seq::TEXT);
END;
$$;

COMMENT ON FUNCTION next_booking_reference(VARCHAR) IS
  'Generates booking_reference DA-{YYYY}-{number:5}-{seq}. Global sequence, resets January 1.';
