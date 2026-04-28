-- 001_initial_schema.sql
-- Daisy First Aid Platform — initial schema (Wave 1B)
-- Tables: da_franchisees, da_territories, da_course_templates
-- Reference: docs/PRD-technical.md §4.2 — §4.4

-- Required extensions ---------------------------------------------------------

-- gen_random_uuid() comes from pgcrypto (already installed on Supabase Postgres).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PostGIS — needed for da_territories.geom (Point, 4326) and the
-- find_nearest_courses helper added in 008. Enable here so 001 can use the type.
CREATE EXTENSION IF NOT EXISTS postgis;

-- da_franchisees --------------------------------------------------------------
-- PRD §4.2. fee_tier stored as integer pounds (100 or 120), all other money is
-- pence elsewhere — kept as pounds here for human readability per PRD note.

CREATE TABLE da_franchisees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  number                VARCHAR(4) NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  phone                 TEXT,
  stripe_account_id     TEXT,
  stripe_connected      BOOLEAN DEFAULT FALSE,
  gocardless_mandate_id TEXT,
  billing_date          INTEGER NOT NULL DEFAULT 28
                        CHECK (billing_date BETWEEN 1 AND 28),
  fee_tier              INTEGER NOT NULL DEFAULT 120,
  vat_registered        BOOLEAN DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'terminated')),
  is_hq                 BOOLEAN DEFAULT FALSE,
  auth_user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                 TEXT
);

COMMENT ON TABLE  da_franchisees IS 'Franchisees and HQ users. is_hq=TRUE rows are HQ admins (Jenni and Chris).';
COMMENT ON COLUMN da_franchisees.fee_tier IS 'Integer pounds: 100 = legacy £100/month, 120 = new £120/month. NOT pence.';
COMMENT ON COLUMN da_franchisees.billing_date IS 'Day of month (1-28) for monthly fee debit.';

-- da_territories --------------------------------------------------------------
-- PRD §4.3. geom auto-populated by trigger added in 007.

CREATE TABLE da_territories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  franchisee_id    UUID REFERENCES da_franchisees(id) ON DELETE SET NULL,
  postcode_prefix  TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  geom             GEOMETRY(Point, 4326),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'vacant', 'reserved'))
);

COMMENT ON TABLE  da_territories IS 'UK postcode-prefix territories. NULL franchisee_id means the territory is vacant.';
COMMENT ON COLUMN da_territories.geom IS 'Auto-set from lat/lng by da_territories_set_geom trigger (007).';

-- da_course_templates ---------------------------------------------------------
-- PRD §4.4. Six rows seeded later in 006.

CREATE TABLE da_course_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  duration_hours       NUMERIC(4,2) NOT NULL,
  default_price_pence  INTEGER NOT NULL CHECK (default_price_pence >= 0),
  default_capacity     INTEGER NOT NULL DEFAULT 12 CHECK (default_capacity > 0),
  age_range            TEXT,
  certification        TEXT,
  description          TEXT,
  is_active            BOOLEAN DEFAULT TRUE
);

COMMENT ON TABLE da_course_templates IS 'Six predefined course types. HQ-only writes; everyone reads.';
