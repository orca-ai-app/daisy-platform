-- 021_course_instance_private_client.sql
--
-- Adds an optional FK from da_course_instances to da_private_clients.
--
-- Purpose:
--   Wave 9C links private courses to a specific client at scheduling time.
--   The franchisee selects a private client in Step 4 of the course-create
--   wizard; that selection is persisted as private_client_id on the instance.
--
--   Wave 8 (booking webhook): when a booking is created for a course instance
--   that carries private_client_id, the webhook copies it onto da_bookings
--   (which already has the private_client_id column from migration 003).
--   This ensures every booking generated from a private course is
--   automatically attributed to the correct client without requiring the
--   end customer to identify themselves.
--
-- Column is nullable because:
--   a) Public courses never have a client.
--   b) Private courses MAY omit the client (bespoke arrangements for
--      ad-hoc groups where no CRM record exists).
--   c) Existing rows are unaffected (NULL default).

ALTER TABLE da_course_instances
  ADD COLUMN private_client_id UUID
    REFERENCES da_private_clients(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN da_course_instances.private_client_id IS
  'Optional: the private client this course was scheduled for. '
  'Wave 8 webhook copies this onto da_bookings.private_client_id '
  'so every booking inherits the client attribution automatically.';

-- Index to support the Wave 8 webhook lookup and any future query that
-- filters course instances by client (e.g. a client-detail view showing
-- all scheduled courses).
CREATE INDEX idx_course_instances_private_client_id
  ON da_course_instances (private_client_id)
  WHERE private_client_id IS NOT NULL;
