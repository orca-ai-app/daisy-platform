-- 006_settings_activities.sql
-- da_settings, da_activities + course-template seed + settings seed
-- Reference: docs/PRD-technical.md §4.15 — §4.16

-- da_activities ---------------------------------------------------------------
-- Insert-only audit trail. No updated_at (rows are immutable once written).

CREATE TABLE da_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('hq', 'franchisee', 'system', 'customer')),
  actor_id     UUID,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  action       TEXT NOT NULL,
  metadata     JSONB,
  description  TEXT
);

COMMENT ON TABLE da_activities IS 'Insert-only audit log. Written by Edge Functions only, never from client.';

-- da_settings -----------------------------------------------------------------

CREATE TABLE da_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT
);

COMMENT ON TABLE da_settings IS 'Network-wide configuration. Stringly-typed; readers cast as needed.';

-- Seed da_course_templates ----------------------------------------------------
-- PRD §4.4 seed table. Prices already in pence (£55 = 5500p, £95 = 9500p, £75 = 7500p).
-- ON CONFLICT DO NOTHING so re-running 006 is a no-op once seeded.

INSERT INTO da_course_templates (slug, name, duration_hours, default_price_pence, default_capacity, description)
VALUES
  ('baby-child-2hr',       'Baby & Child First Aid (2hr)',         2.00, 5500, 12,
   'Two-hour introductory baby and child first aid session for parents and carers.'),
  ('baby-child-full-day',  'Baby & Child First Aid (Full Day)',    6.00, 9500, 12,
   'Full-day baby and child first aid covering CPR, choking, burns, anaphylaxis and more.'),
  ('paediatric-aow',       'Paediatric First Aid (Award of Worth)', 6.00, 9500, 12,
   'Award of Worth-accredited paediatric first aid for childcare professionals.'),
  ('emergency-paediatric', 'Emergency Paediatric First Aid',        6.00, 9500, 12,
   'Emergency paediatric first aid suitable for early years and Ofsted requirements.'),
  ('blended-learning',     'Blended Learning Course',               3.00, 7500, 12,
   'Blended online + in-person first aid course.'),
  ('corporate-bespoke',    'Corporate Bespoke',                     3.00,    0, 12,
   'Bespoke corporate first aid session — price agreed per booking.')
ON CONFLICT (slug) DO NOTHING;

-- Seed da_settings ------------------------------------------------------------
-- M1 build plan §5 final paragraph + PRD §4.16.

INSERT INTO da_settings (key, value, description)
VALUES
  ('gdpr_medical_retention_years', '3',  'Years to retain medical declarations.'),
  ('interest_form_min_attendees',  '5',  'Minimum attendees to trigger interest form vs redirect.'),
  ('course_finder_radius_miles',   '15', 'Default search radius for the public course finder.'),
  ('stripe_platform_fee_percent',  '2',  'Application fee on Stripe Connect transactions (percent).')
ON CONFLICT (key) DO NOTHING;
