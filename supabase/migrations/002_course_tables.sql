-- 002_course_tables.sql
-- da_course_instances, da_ticket_types
-- Reference: docs/PRD-technical.md §4.5 — §4.6

-- da_course_instances ---------------------------------------------------------

CREATE TABLE da_course_instances (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  franchisee_id            UUID NOT NULL REFERENCES da_franchisees(id),
  template_id              UUID NOT NULL REFERENCES da_course_templates(id),
  territory_id             UUID REFERENCES da_territories(id),
  event_date               DATE NOT NULL,
  start_time               TIME NOT NULL,
  end_time                 TIME NOT NULL,
  venue_name               TEXT,
  venue_address            TEXT,
  venue_postcode           TEXT NOT NULL,
  lat                      DOUBLE PRECISION,
  lng                      DOUBLE PRECISION,
  geom                     GEOMETRY(Point, 4326),
  visibility               TEXT NOT NULL DEFAULT 'public'
                           CHECK (visibility IN ('public', 'private')),
  capacity                 INTEGER NOT NULL CHECK (capacity > 0),
  spots_remaining          INTEGER NOT NULL CHECK (spots_remaining >= 0),
  price_pence              INTEGER NOT NULL CHECK (price_pence >= 0),
  bespoke_details          TEXT,
  status                   TEXT NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  stripe_payment_link      TEXT,
  out_of_territory         BOOLEAN DEFAULT FALSE,
  out_of_territory_warning TEXT
                           CHECK (out_of_territory_warning IS NULL
                                  OR out_of_territory_warning IN ('owned_by_other', 'vacant'))
);

COMMENT ON TABLE  da_course_instances IS 'Concrete course events scheduled by a franchisee.';
COMMENT ON COLUMN da_course_instances.geom IS 'Auto-set from lat/lng by da_course_instances_set_geom trigger (007).';
COMMENT ON COLUMN da_course_instances.spots_remaining IS 'Decremented atomically by decrement_spots() (008).';

-- da_ticket_types -------------------------------------------------------------

CREATE TABLE da_ticket_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  course_instance_id  UUID NOT NULL REFERENCES da_course_instances(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  price_pence         INTEGER NOT NULL CHECK (price_pence >= 0),
  seats_consumed      INTEGER NOT NULL DEFAULT 1 CHECK (seats_consumed > 0),
  max_available       INTEGER CHECK (max_available IS NULL OR max_available > 0),
  sort_order          INTEGER DEFAULT 0
);

COMMENT ON TABLE da_ticket_types IS 'Ticket variants per course (Single/Couple/Family/custom).';
