-- 053: online course templates (Jenni, 2 Sep).
--
-- An online template's classes have no venue: no postcode, no geocode, no
-- territory gate, and they appear in every course-finder search regardless of
-- where the customer is. Jenni's "Online Baby And Child First Aid Class"
-- template (slug online-class) is flagged and activated here.
ALTER TABLE da_course_templates ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;

UPDATE da_course_templates SET is_online = true, is_active = true WHERE slug = 'online-class';
