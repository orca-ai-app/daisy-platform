-- 009_indexes.sql
-- All indexes per PRD §4.17, verbatim.

CREATE INDEX idx_course_instances_franchisee        ON da_course_instances(franchisee_id);
CREATE INDEX idx_course_instances_date              ON da_course_instances(event_date);
CREATE INDEX idx_course_instances_postcode          ON da_course_instances(venue_postcode);
CREATE INDEX idx_course_instances_visibility_status ON da_course_instances(visibility, status);
CREATE INDEX idx_course_instances_geom              ON da_course_instances USING GIST(geom);

CREATE INDEX idx_bookings_franchisee     ON da_bookings(franchisee_id);
CREATE INDEX idx_bookings_customer       ON da_bookings(customer_id);
CREATE INDEX idx_bookings_course         ON da_bookings(course_instance_id);
CREATE INDEX idx_bookings_reference      ON da_bookings(booking_reference);
CREATE INDEX idx_bookings_payment_status ON da_bookings(payment_status);

CREATE INDEX idx_territories_postcode   ON da_territories(postcode_prefix);
CREATE INDEX idx_territories_franchisee ON da_territories(franchisee_id);
CREATE INDEX idx_territories_geom       ON da_territories USING GIST(geom);

CREATE INDEX idx_medical_declarations_franchisee ON da_medical_declarations(franchisee_id);
CREATE INDEX idx_medical_declarations_course     ON da_medical_declarations(course_instance_id);
CREATE INDEX idx_medical_declarations_retention  ON da_medical_declarations(gdpr_retention_expires_at);

CREATE INDEX idx_billing_runs_franchisee     ON da_billing_runs(franchisee_id);
CREATE INDEX idx_billing_runs_period         ON da_billing_runs(billing_period_start, billing_period_end);
CREATE INDEX idx_billing_runs_payment_status ON da_billing_runs(payment_status);

CREATE INDEX idx_activities_entity  ON da_activities(entity_type, entity_id);
CREATE INDEX idx_activities_created ON da_activities(created_at DESC);

CREATE INDEX idx_email_sequences_scheduled ON da_email_sequences(scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_email_sequences_booking   ON da_email_sequences(booking_id);
