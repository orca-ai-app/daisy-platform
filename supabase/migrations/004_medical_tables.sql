-- 004_medical_tables.sql
-- da_medical_declarations, da_interest_forms
-- Reference: docs/PRD-technical.md §4.10 — §4.11

-- da_medical_declarations -----------------------------------------------------
-- Per PRD §4.10 declaration_data is encrypted JSONB stored as BYTEA.
-- Encryption happens at the Edge Function level (M3 work). M1 just stands up
-- the schema. No updated_at column per PRD — declarations are insert-only audit
-- records, mutated only by GDPR purge job.

CREATE TABLE da_medical_declarations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  franchisee_id             UUID NOT NULL REFERENCES da_franchisees(id),
  territory_postcode        TEXT NOT NULL,
  course_instance_id        UUID REFERENCES da_course_instances(id),
  booking_id                UUID REFERENCES da_bookings(id),
  attendee_name             TEXT NOT NULL,
  attendee_email            TEXT,
  declaration_data          BYTEA NOT NULL,
  consent_given             BOOLEAN NOT NULL DEFAULT FALSE,
  consent_timestamp         TIMESTAMPTZ,
  gdpr_retention_expires_at TIMESTAMPTZ,
  ip_address                INET,
  user_agent                TEXT
);

COMMENT ON TABLE  da_medical_declarations IS 'Encrypted medical declarations. AES-256-GCM ciphertext in declaration_data.';
COMMENT ON COLUMN da_medical_declarations.gdpr_retention_expires_at IS 'NOW() + INTERVAL "3 years" at insert. Purged by purge-medical-declarations job.';

-- da_interest_forms -----------------------------------------------------------

CREATE TABLE da_interest_forms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  postcode            TEXT NOT NULL,
  num_attendees       INTEGER NOT NULL CHECK (num_attendees > 0),
  preferred_dates     TEXT,
  venue_preference    TEXT,
  contact_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'contacted', 'booked', 'declined', 'expired')),
  assigned_freelancer TEXT,
  notes               TEXT
);

COMMENT ON TABLE da_interest_forms IS 'Vacant-territory interest captured from booking widget when ≥5 attendees.';
