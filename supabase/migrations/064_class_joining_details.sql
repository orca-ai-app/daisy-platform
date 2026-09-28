-- 064: per-class joining details, emailed only to people who book.
--
-- Venue sign-in instructions, parking, what to bring, or the Zoom link for an
-- online class (Julie, TRI-0026; October retainer item "per-class extra
-- confirmation lines"). Goes out on the booking confirmation, the day-before
-- reminder, the one-hour reminder and the course-updated email. Never returned
-- by the public search (get-public-courses maps explicit fields), and
-- da_course_instances has no anon read policy, so a joining link stays private
-- until someone has paid.

ALTER TABLE da_course_instances
  ADD COLUMN IF NOT EXISTS joining_details text;

ALTER TABLE da_course_instances
  DROP CONSTRAINT IF EXISTS da_course_instances_joining_details_len;
ALTER TABLE da_course_instances
  ADD CONSTRAINT da_course_instances_joining_details_len
  CHECK (joining_details IS NULL OR char_length(joining_details) <= 1000);
