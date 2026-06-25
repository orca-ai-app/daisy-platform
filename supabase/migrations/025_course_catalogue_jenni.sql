-- 025_course_catalogue_jenni.sql
-- Set the course catalogue (da_course_templates) to Jenni's confirmed 12-course
-- list (June 2026 review feedback, item 5 "Schedule a course").
-- All data points confirmed by Jenni 2026-06-17.
--
-- STRATEGY (revised): the original plan was hard-replace (delete the old 6),
-- but every existing template has 41-44 live course instances (253 total) and
-- da_course_instances.template_id is NOT NULL REFERENCES da_course_templates(id)
-- with no ON DELETE clause (restrict) — so a DELETE is rejected by Postgres and
-- would orphan nothing because it simply cannot run. We therefore DEACTIVATE the
-- 6 existing templates (is_active = false) — which keeps all 253 instances and
-- their bookings valid and removes them from NEW scheduling (the franchisee
-- CreateCourse query filters is_active = true) — and INSERT the 12 new courses
-- as active. The HQ Templates page lists all rows (active + inactive); a follow-up
-- can hide inactive there or merge/clean up the archived rows later.
--
-- Notes on Jenni's answers:
--   • certification: 'yes' for the Level 3 + Work courses (always certificated);
--     'if_requested' for the awareness classes (certificates are optional).
--   • age_range is left NULL — the franchisee scheduling UI renders it as
--     "Ages {value}" (CreateCourse.tsx), so the "Suitable for…" audience text
--     belongs in the description, not age_range.
--   • #11 First Aid Class For Children — £3 per child; runs one or two hours by age.
--   • #12 Bespoke — price on request (0), typically ~2 hours.

-- 1. Archive the existing catalogue (keep rows for the 253 live instances) -----
UPDATE da_course_templates SET is_active = false WHERE is_active = true;

-- 2. Insert Jenni's 12 courses -------------------------------------------------
-- Prices in pence (£20 = 2000). certification: yes | no | if_requested.
INSERT INTO da_course_templates
  (slug, name, duration_hours, default_price_pence, default_capacity, age_range, certification, description, is_active)
VALUES
  ('baby-first-aid-essentials',
   'Baby First Aid Essentials Class',
   1.00, 2000, 12, NULL, 'if_requested',
   'One-hour baby first aid basics. Suitable for families and carers.', TRUE),

  ('baby-child-first-aid',
   'Baby and Child First Aid Class',
   2.00, 3000, 12, NULL, 'if_requested',
   'Two-hour baby and child first aid awareness class. Suitable for families and carers.', TRUE),

  ('baby-child-first-aid-duty-of-care',
   'Baby and Child First Aid Class — Duty of Care',
   2.00, 3000, 12, NULL, 'if_requested',
   'Two-hour baby and child first aid awareness class for activity providers. Suitable for children''s activity providers.', TRUE),

  ('family-first-aid',
   'Family First Aid Class',
   2.00, 3000, 12, NULL, 'if_requested',
   'Two-hour first aid awareness class for families. Suitable for families and carers.', TRUE),

  ('basic-life-saver',
   'Basic Life Saver Class',
   2.00, 3000, 12, NULL, 'if_requested',
   'Two-hour first aid awareness class. Suitable for businesses, shops and restaurants.', TRUE),

  ('anaphylaxis-awareness',
   'Anaphylaxis Awareness Class',
   1.00, 2000, 12, NULL, 'if_requested',
   'One-hour class covering allergies, anaphylaxis and CPR. Suitable for schools, colleges and restaurants.', TRUE),

  ('level-3-emergency-paediatric-first-aid',
   'Level 3 Emergency Paediatric First Aid Course',
   6.00, 8500, 12, NULL, 'yes',
   'One day (6 hours) of practical training. Suitable for nurseries and childcare professionals.', TRUE),

  ('level-3-blended-paediatric-first-aid',
   'Level 3 Blended Paediatric First Aid Course',
   6.00, 9500, 12, NULL, 'yes',
   'Online learning (6 hours) plus one day (6 hours) of practical training. Suitable for nurseries and childcare professionals.', TRUE),

  ('emergency-first-aid-at-work',
   'Emergency First Aid At Work',
   6.00, 9500, 12, NULL, 'yes',
   'One day (6 hours) of practical training. Suitable for workplace first aiders.', TRUE),

  ('first-aid-at-work',
   'First Aid At Work',
   12.00, 22500, 12, NULL, 'yes',
   'Three-day course: online learning (6 hours) plus two days (12 hours) of classroom training. Suitable for workplace first aiders.', TRUE),

  ('first-aid-for-children',
   'First Aid Class For Children',
   1.00, 300, 12, NULL, 'if_requested',
   'One or two hour classes depending on ages. Suitable for schools, home learning, Scouts and children''s clubs.', TRUE),

  ('bespoke-first-aid',
   'Bespoke First Aid Class',
   2.00, 0, 12, NULL, 'if_requested',
   'Bespoke first aid class, typically around two hours; price agreed per booking. Suitable for anyone.', TRUE);
