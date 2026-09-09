-- 055: B2B VAT presentation (Hannah, pre-go-live).
--
-- vat_exclusive on a ticket: the charged price_pence stays the GROSS amount
-- (checkout, Stripe, refunds and reporting are untouched) but the ticket is
-- ENTERED as ex-VAT and DISPLAYED as "ex + VAT = total". vat_number on the
-- franchisee feeds the widget display and the VAT-invoice block on the
-- confirmation email so business customers can reclaim.
ALTER TABLE da_ticket_types ADD COLUMN IF NOT EXISTS vat_exclusive boolean NOT NULL DEFAULT false;
ALTER TABLE da_franchisees ADD COLUMN IF NOT EXISTS vat_number text;

CREATE OR REPLACE FUNCTION public.find_nearest_courses(search_lat double precision, search_lng double precision, radius_miles integer)
 RETURNS TABLE(id uuid, template_id uuid, template_name text, template_slug text, template_description text, description_override text, age_range text, franchisee_id uuid, franchisee_name text, event_date date, start_time time without time zone, end_time time without time zone, venue_name text, venue_postcode text, capacity integer, spots_remaining integer, price_pence integer, status text, visibility text, distance_miles double precision, ticket_types jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  WITH search_point AS (
    SELECT ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography AS g
  )
  SELECT
    ci.id,
    ci.template_id,
    ct.name           AS template_name,
    ct.slug           AS template_slug,
    ct.description    AS template_description,
    ci.description_override,
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
            'sort_order',     tt.sort_order,
            'session_label',  tt.session_label,
            'vat_rate',       tt.vat_rate,
            'vat_exclusive',  tt.vat_exclusive
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
    AND ci.event_date >= CURRENT_DATE
    AND ST_DWithin(ci.geom::geography, sp.g, radius_miles * 1609.344)
  ORDER BY distance_miles ASC, ci.event_date ASC;
$function$
;
