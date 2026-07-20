-- 039_nearest_courses_description.sql
-- M3 feedback §1 (Jenni): parents should see the class content and who it's
-- suitable for BEFORE booking. Adds template description + age_range to the
-- public course search. RETURNS TABLE changes require drop + recreate.
--
-- This is migration 039 — do NOT renumber.

DROP FUNCTION IF EXISTS find_nearest_courses(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);

CREATE FUNCTION find_nearest_courses(
  search_lat    DOUBLE PRECISION,
  search_lng    DOUBLE PRECISION,
  radius_miles  INTEGER
)
RETURNS TABLE (
  id                   UUID,
  template_id          UUID,
  template_name        TEXT,
  template_slug        TEXT,
  template_description TEXT,
  age_range            TEXT,
  franchisee_id        UUID,
  franchisee_name      TEXT,
  event_date           DATE,
  start_time           TIME,
  end_time             TIME,
  venue_name           TEXT,
  venue_postcode       TEXT,
  capacity             INTEGER,
  spots_remaining      INTEGER,
  price_pence          INTEGER,
  status               TEXT,
  visibility           TEXT,
  distance_miles       DOUBLE PRECISION,
  ticket_types         JSONB
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
    ct.description    AS template_description,
    ct.age_range,
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
