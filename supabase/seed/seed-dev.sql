-- ============================================================
-- Daisy First Aid - M1 Wave 5B demo seed
-- Idempotent: re-running drops & re-creates the seeded data only.
-- Preserves the 3 existing test fixtures:
--   dev@daisyfirstaid.com (Chris HQ, number 0000)
--   hq-test-2c@daisyfirstaid.com (HQ Test 2C, number H001)
--   franchisee-test-2c@daisyfirstaid.com (Franchisee Test 2C, number F001)
-- 
-- Wave 4C data patch: course_instance d937d523... had Manchester postcode (M1 1AE)
-- but was linked to E1 territory. We resolve this by deleting Wave 3/4 ad-hoc
-- seed data wholesale (criteria: bespoke_details=wave-4b-seed OR notes=wave-3b-seed)
-- and replacing with the canonical seed below where territory_id and venue_postcode
-- are coherent by construction.
-- ============================================================

BEGIN;

-- 1. Cleanup prior ad-hoc Wave 3/4 seed data + any prior seed-dev rows
-- 
-- Strategy: aggressive but safe. We wipe ALL bookings, courses, ticket types,
-- customers, interest forms, billing runs - the data Wave 3/4 seeded was
-- ad-hoc and we're replacing it with the canonical Wave 5B layout. The 3 test-fixture
-- franchisees (dev@, hq-test-2c@, franchisee-test-2c@) and their auth.users rows
-- are preserved. Real HQ-portal usage activity rows are preserved by deleting
-- only seed-dev-style activity ids.
-- 
-- Order matters (FK constraints):
--   email_sequences -> bookings -> ticket_types -> course_instances -> customers
--   billing_runs -> activities (no FK, ordering not required)
--   interest_forms (no FK)
--   territories -> franchisees

-- Delete every email sequence (they FK booking + customer; we wipe both).
DELETE FROM da_email_sequences;

-- Delete ALL bookings. Wave 3B/Wave 4B seed bookings + any prior seed-dev runs.
-- Real HQ-portal-created bookings are also wiped here, but at this stage of M1
-- there are none in the live DB (only seed bookings exist).
DELETE FROM da_bookings;

-- Delete ALL ticket types (FK course_instances).
DELETE FROM da_ticket_types;

-- Delete ALL course instances. This includes the Wave 4C course
-- d937d523-8ca8-4d30-854e-19e46d3d8809 (M1 1AE postcode incorrectly linked to E1 territory)
-- so the Wave 4C data patch is resolved by dropping the row entirely.
DELETE FROM da_course_instances;

-- Delete prior seed-style customers. Real (non-seed) customers preserved by email pattern.
DELETE FROM da_customers WHERE email LIKE '%+seed@example.com' OR email LIKE '%+seed3b@example.com';

-- Delete ALL interest forms (Wave 3 ad-hoc + prior seed-dev). Re-seeded below.
DELETE FROM da_interest_forms;

-- Delete ALL billing runs (none real yet at this point in M1).
DELETE FROM da_billing_runs;

-- Delete activity rows that match our seeded id ranges, plus wave-3 leftovers.
-- Wave 3's ad-hoc activities reference deleted entities (EC2A territory, etc),
-- so they appear in the recent-activity feed as broken-link rows. Drop them.
-- Genuine HQ-portal usage activities (created after demo handover) are preserved
-- by the where-clause: only rows older than 2026-04-29T18:00 UTC and matching
-- the wave-3 entity-text patterns get wiped.
DELETE FROM da_activities WHERE id IN (
  'd1f81111-0000-4000-8000-000000000001',
  'd1f81111-0000-4000-8000-000000000002',
  'd1f81111-0000-4000-8000-000000000003',
  'd1f81111-0000-4000-8000-000000000004',
  'd1f81111-0000-4000-8000-000000000005',
  'd1f81111-0000-4000-8000-000000000006',
  'd1f81111-0000-4000-8000-000000000007',
  'd1f81111-0000-4000-8000-000000000008',
  'd1f81111-0000-4000-8000-000000000009',
  'd1f81111-0000-4000-8000-000000000010',
  'd1f81111-0000-4000-8000-000000000011',
  'd1f81111-0000-4000-8000-000000000012',
  'd1f81111-0000-4000-8000-000000000013',
  'd1f81111-0000-4000-8000-000000000014',
  'd1f81111-0000-4000-8000-000000000015',
  'd1f81111-0000-4000-8000-000000000016',
  'd1f81111-0000-4000-8000-000000000017',
  'd1f81111-0000-4000-8000-000000000018',
  'd1f81111-0000-4000-8000-000000000019',
  'd1f81111-0000-4000-8000-000000000020',
  'd1f81111-0000-4000-8000-000000000021',
  'd1f81111-0000-4000-8000-000000000022',
  'd1f81111-0000-4000-8000-000000000023',
  'd1f81111-0000-4000-8000-000000000024',
  'd1f81111-0000-4000-8000-000000000025',
  'd1f81111-0000-4000-8000-000000000026',
  'd1f81111-0000-4000-8000-000000000027',
  'd1f81111-0000-4000-8000-000000000028',
  'd1f81111-0000-4000-8000-000000000029',
  'd1f81111-0000-4000-8000-000000000030'
);

-- Catch the wave-3 ad-hoc activities (referencing EC2A, EC1A 1BB, SW1A 1AA - status from new to contacted).
DELETE FROM da_activities WHERE description LIKE '%EC2A%' OR description LIKE '%EC1A 1BB%' OR description LIKE '%Wave 4B test%' OR (description LIKE '%SW1A 1AA%' AND action = 'interest_form_updated' AND created_at < '2026-04-29 17:00:00+00') OR (action = 'geocode' AND description = 'Geocoded SW1A 1AA');

-- Now safe to delete every territory we are about to (re)insert.
DELETE FROM da_territories WHERE postcode_prefix IN (
  'SW1A',
  'SW4',
  'NW1',
  'NW3',
  'W5',
  'W2',
  'E1',
  'E14',
  'BS1',
  'BS8',
  'B1',
  'B16',
  'M1',
  'M14',
  'LS1',
  'LS6',
  'CF10',
  'NE1',
  'PL1',
  'AB10'
) OR postcode_prefix LIKE 'NorthShore%' OR postcode_prefix IN ('EC2A', 'SE1', 'W1');

-- Delete franchisees we are about to insert. The 3 test fixtures are NOT in this
-- list (different ids and emails), so they are preserved.
DELETE FROM da_franchisees WHERE id IN (
  'd1f1aaaa-0000-4000-8000-000000000001',
  'd1f1aaaa-0000-4000-8000-000000000002',
  'd1f1aaaa-0000-4000-8000-000000000003',
  'd1f1aaaa-0000-4000-8000-000000000004',
  'd1f1aaaa-0000-4000-8000-000000000005',
  'd1f1aaaa-0000-4000-8000-000000000006',
  'd1f1aaaa-0000-4000-8000-000000000007',
  'd1f1aaaa-0000-4000-8000-000000000008',
  'd1f1aaaa-0000-4000-8000-000000000009',
  'd1f1aaaa-0000-4000-8000-000000000010'
) OR email IN (
  'jenni@daisyfirstaid.com',
  'ashley.carter@daisyfirstaid.com',
  'sarah.hughes@daisyfirstaid.com',
  'maria.oconnell@daisyfirstaid.com',
  'rachel.patel@daisyfirstaid.com',
  'emma.williams@daisyfirstaid.com',
  'charlotte.thomas@daisyfirstaid.com',
  'lucy.brown@daisyfirstaid.com',
  'jess.singh@daisyfirstaid.com',
  'david.owen@daisyfirstaid.com'
);

-- 2. Insert franchisees (Jenni HQ + Ashley + 8 fakes). Test fixtures untouched.
INSERT INTO da_franchisees (id, number, name, email, phone, billing_date, fee_tier, vat_registered, status, is_hq, notes) VALUES
  ('d1f1aaaa-0000-4000-8000-000000000001', '0010', 'Jenni Dunman', 'jenni@daisyfirstaid.com', '07700900100', 28, 120, FALSE, 'active', TRUE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000002', '0001', 'Ashley Carter', 'ashley.carter@daisyfirstaid.com', '07700900111', 28, 120, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000003', '0002', 'Sarah Hughes', 'sarah.hughes@daisyfirstaid.com', '07700900112', 28, 120, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000004', '0003', 'Maria O''Connell', 'maria.oconnell@daisyfirstaid.com', '07700900113', 28, 100, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000005', '0004', 'Rachel Patel', 'rachel.patel@daisyfirstaid.com', '07700900114', 28, 120, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000006', '0005', 'Emma Williams', 'emma.williams@daisyfirstaid.com', '07700900115', 28, 100, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000007', '0006', 'Charlotte Thomas', 'charlotte.thomas@daisyfirstaid.com', '07700900116', 28, 120, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000008', '0007', 'Lucy Brown', 'lucy.brown@daisyfirstaid.com', '07700900117', 28, 120, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000009', '0008', 'Jess Singh', 'jess.singh@daisyfirstaid.com', '07700900118', 28, 100, FALSE, 'active', FALSE, 'seed-dev'),
  ('d1f1aaaa-0000-4000-8000-000000000010', '0009', 'David Owen', 'david.owen@daisyfirstaid.com', '07700900119', 28, 120, FALSE, 'active', FALSE, 'seed-dev');

-- 3. Territories with realistic UK postcodes + lat/lng.
INSERT INTO da_territories (id, franchisee_id, postcode_prefix, name, lat, lng, status) VALUES
  ('d1f2bbbb-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000002', 'SW1A', 'Westminster', 51.5014, -0.1419, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000002', 'd1f1aaaa-0000-4000-8000-000000000002', 'SW4', 'Clapham', 51.4628, -0.1411, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000003', 'd1f1aaaa-0000-4000-8000-000000000003', 'NW1', 'Camden', 51.539, -0.1426, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000004', 'd1f1aaaa-0000-4000-8000-000000000003', 'NW3', 'Hampstead', 51.5563, -0.1781, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000005', 'd1f1aaaa-0000-4000-8000-000000000004', 'W5', 'Ealing', 51.513, -0.3013, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000006', 'd1f1aaaa-0000-4000-8000-000000000004', 'W2', 'Paddington', 51.518, -0.1759, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000007', 'd1f1aaaa-0000-4000-8000-000000000005', 'E1', 'Whitechapel', 51.5174, -0.0593, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000008', 'd1f1aaaa-0000-4000-8000-000000000005', 'E14', 'Canary Wharf', 51.505, -0.0214, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000009', 'd1f1aaaa-0000-4000-8000-000000000006', 'BS1', 'Bristol Centre', 51.4545, -2.5879, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000010', 'd1f1aaaa-0000-4000-8000-000000000006', 'BS8', 'Clifton', 51.456, -2.6178, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000011', 'd1f1aaaa-0000-4000-8000-000000000007', 'B1', 'Birmingham Centre', 52.4814, -1.9116, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000012', 'd1f1aaaa-0000-4000-8000-000000000007', 'B16', 'Edgbaston', 52.4761, -1.9326, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000013', 'd1f1aaaa-0000-4000-8000-000000000008', 'M1', 'Manchester Centre', 53.4794, -2.2453, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000014', 'd1f1aaaa-0000-4000-8000-000000000008', 'M14', 'Fallowfield', 53.4376, -2.2272, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000015', 'd1f1aaaa-0000-4000-8000-000000000009', 'LS1', 'Leeds Centre', 53.7997, -1.5492, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000016', 'd1f1aaaa-0000-4000-8000-000000000009', 'LS6', 'Headingley', 53.8184, -1.58, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000017', 'bb7c1ce3-41b3-4416-a78e-a7945d674a5c', 'CF10', 'Cardiff Centre', 51.4837, -3.1681, 'active'),
  ('d1f2bbbb-0000-4000-8000-000000000018', NULL, 'NE1', 'Newcastle', 54.9783, -1.6178, 'vacant'),
  ('d1f2bbbb-0000-4000-8000-000000000019', NULL, 'PL1', 'Plymouth', 50.3755, -4.1427, 'vacant'),
  ('d1f2bbbb-0000-4000-8000-000000000020', NULL, 'AB10', 'Aberdeen', 57.1497, -2.0943, 'vacant');

-- 4. Customers (UK names). Email is unique key.
INSERT INTO da_customers (id, first_name, last_name, email, phone, postcode) VALUES
  ('d1f5eeee-0000-4000-8000-000000000001', 'Olivia', 'Smith', 'olivia.smith+seed@example.com', '07700000000', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000002', 'Amelia', 'Jones', 'amelia.jones+seed@example.com', '07700000013', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000003', 'Isla', 'Williams', 'isla.williams+seed@example.com', '07700000026', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000004', 'Ava', 'Brown', 'ava.brown+seed@example.com', '07700000039', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000005', 'Mia', 'Taylor', 'mia.taylor+seed@example.com', '07700000052', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000006', 'Sophia', 'Davies', 'sophia.davies+seed@example.com', '07700000065', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000007', 'Lily', 'Wilson', 'lily.wilson+seed@example.com', '07700000078', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000008', 'Grace', 'Evans', 'grace.evans+seed@example.com', '07700000091', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000009', 'Emily', 'Thomas', 'emily.thomas+seed@example.com', '07700000104', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000010', 'Charlotte', 'Roberts', 'charlotte.roberts+seed@example.com', '07700000117', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000011', 'Daniel', 'Walker', 'daniel.walker+seed@example.com', '07700000130', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000012', 'Harry', 'Hall', 'harry.hall+seed@example.com', '07700000143', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000013', 'James', 'Wright', 'james.wright+seed@example.com', '07700000156', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000014', 'George', 'Green', 'george.green+seed@example.com', '07700000169', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000015', 'Oscar', 'Lewis', 'oscar.lewis+seed@example.com', '07700000182', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000016', 'Henry', 'Hughes', 'henry.hughes+seed@example.com', '07700000195', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000017', 'Noah', 'Edwards', 'noah.edwards+seed@example.com', '07700000208', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000018', 'Jacob', 'Carter', 'jacob.carter+seed@example.com', '07700000221', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000019', 'Leo', 'Mitchell', 'leo.mitchell+seed@example.com', '07700000234', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000020', 'Alfie', 'Turner', 'alfie.turner+seed@example.com', '07700000247', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000021', 'Freya', 'Phillips', 'freya.phillips+seed@example.com', '07700000260', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000022', 'Poppy', 'Campbell', 'poppy.campbell+seed@example.com', '07700000273', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000023', 'Daisy', 'Parker', 'daisy.parker+seed@example.com', '07700000286', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000024', 'Mila', 'Bennett', 'mila.bennett+seed@example.com', '07700000299', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000025', 'Ivy', 'Hayes', 'ivy.hayes+seed@example.com', '07700000312', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000026', 'Aria', 'Cox', 'aria.cox+seed@example.com', '07700000325', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000027', 'Luna', 'Harvey', 'luna.harvey+seed@example.com', '07700000338', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000028', 'Willow', 'Reid', 'willow.reid+seed@example.com', '07700000351', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000029', 'Nora', 'Spencer', 'nora.spencer+seed@example.com', '07700000364', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000030', 'Ruby', 'Lawson', 'ruby.lawson+seed@example.com', '07700000377', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000031', 'Liam', 'Murray', 'liam.murray+seed@example.com', '07700000390', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000032', 'Theo', 'Holmes', 'theo.holmes+seed@example.com', '07700000403', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000033', 'Arthur', 'Burke', 'arthur.burke+seed@example.com', '07700000416', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000034', 'Finley', 'Lambert', 'finley.lambert+seed@example.com', '07700000429', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000035', 'Caleb', 'Lloyd', 'caleb.lloyd+seed@example.com', '07700000442', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000036', 'Joshua', 'Doyle', 'joshua.doyle+seed@example.com', '07700000455', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000037', 'Reuben', 'Ford', 'reuben.ford+seed@example.com', '07700000468', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000038', 'Sebastian', 'Knight', 'sebastian.knight+seed@example.com', '07700000481', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000039', 'Felix', 'Stewart', 'felix.stewart+seed@example.com', '07700000494', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000040', 'Joseph', 'Cole', 'joseph.cole+seed@example.com', '07700000507', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000041', 'Hannah', 'Patel', 'hannah.patel+seed@example.com', '07700000520', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000042', 'Maya', 'Kapoor', 'maya.kapoor+seed@example.com', '07700000533', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000043', 'Aisha', 'Ahmed', 'aisha.ahmed+seed@example.com', '07700000546', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000044', 'Zara', 'Khan', 'zara.khan+seed@example.com', '07700000559', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000045', 'Anya', 'Sharma', 'anya.sharma+seed@example.com', '07700000572', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000046', 'Priya', 'Mistry', 'priya.mistry+seed@example.com', '07700000585', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000047', 'Sana', 'Begum', 'sana.begum+seed@example.com', '07700000598', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000048', 'Layla', 'Rashid', 'layla.rashid+seed@example.com', '07700000611', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000049', 'Maryam', 'Hassan', 'maryam.hassan+seed@example.com', '07700000624', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000050', 'Yusuf', 'Ali', 'yusuf.ali+seed@example.com', '07700000637', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000051', 'Caitlin', 'Murphy', 'caitlin.murphy+seed@example.com', '07700000650', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000052', 'Niamh', 'Ryan', 'niamh.ryan+seed@example.com', '07700000663', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000053', 'Saoirse', 'Walsh', 'saoirse.walsh+seed@example.com', '07700000676', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000054', 'Aoife', 'Kelly', 'aoife.kelly+seed@example.com', '07700000689', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000055', 'Eilidh', 'Robertson', 'eilidh.robertson+seed@example.com', '07700000702', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000056', 'Cerys', 'Davies', 'cerys.davies+seed@example.com', '07700000715', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000057', 'Bethan', 'Morgan', 'bethan.morgan+seed@example.com', '07700000728', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000058', 'Catrin', 'Lewis', 'catrin.lewis+seed@example.com', '07700000741', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000059', 'Carys', 'Pugh', 'carys.pugh+seed@example.com', '07700000754', 'SW1A 1AA'),
  ('d1f5eeee-0000-4000-8000-000000000060', 'Nia', 'Jenkins', 'nia.jenkins+seed@example.com', '07700000767', 'SW1A 1AA');

-- 5. Course instances - 50 total, 5 per owner. Mix of completed/scheduled/cancelled.
-- Templates referenced by slug for forward-compatibility.
INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000001',
  'd1f1aaaa-0000-4000-8000-000000000002',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000001',
  '2026-03-10'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '11 Oak Avenue',
  'SW1A 1AA',
  51.5014, -0.1419,
  'public',
  12, 6, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-02-08 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000002',
  'd1f1aaaa-0000-4000-8000-000000000002',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000001',
  '2026-04-04'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '11 Oak Avenue',
  'SW4 7AA',
  51.5014, -0.1419,
  'public',
  12, 6, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-05 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000003',
  'd1f1aaaa-0000-4000-8000-000000000002',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000001',
  '2026-05-09'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '11 Oak Avenue',
  'SW1A 1AA',
  51.5014, -0.1419,
  'public',
  12, 8, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-09 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000004',
  'd1f1aaaa-0000-4000-8000-000000000002',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000001',
  '2026-06-03'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '11 Oak Avenue',
  'SW4 7AA',
  51.5014, -0.1419,
  'public',
  12, 9, 7500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-04 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000005',
  'd1f1aaaa-0000-4000-8000-000000000002',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000001',
  '2026-04-19'::date,
  '14:00:00'::time,
  '20:00'::time,
  'Town Hall Function Room',
  '11 Oak Avenue',
  'SW1A 1AA',
  51.5014, -0.1419,
  'private',
  12, 0, 50000,
  'Corporate booking - finance team training day',
  'completed',
  FALSE,
  '2026-03-20 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'corporate-bespoke';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000006',
  'd1f1aaaa-0000-4000-8000-000000000003',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000003',
  '2026-03-09'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '22 Oak Avenue',
  'NW1 8XU',
  51.539, -0.1426,
  'public',
  12, 3, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-02-07 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000007',
  'd1f1aaaa-0000-4000-8000-000000000003',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000003',
  '2026-04-05'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '22 Oak Avenue',
  'NW3 2QG',
  51.539, -0.1426,
  'public',
  12, 2, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-06 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000008',
  'd1f1aaaa-0000-4000-8000-000000000003',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000003',
  '2026-05-11'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '22 Oak Avenue',
  'NW1 8XU',
  51.539, -0.1426,
  'public',
  12, 7, 7500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-11 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000009',
  'd1f1aaaa-0000-4000-8000-000000000003',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000003',
  '2026-06-04'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '22 Oak Avenue',
  'NW3 2QG',
  51.539, -0.1426,
  'public',
  12, 9, 5500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-05 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000010',
  'd1f1aaaa-0000-4000-8000-000000000003',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000003',
  '2026-06-24'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '22 Oak Avenue',
  'NW1 8XU',
  51.539, -0.1426,
  'public',
  12, 9, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-05-25 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000011',
  'd1f1aaaa-0000-4000-8000-000000000004',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000005',
  '2026-03-08'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '33 Oak Avenue',
  'W5 5DB',
  51.513, -0.3013,
  'public',
  12, 5, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-02-06 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000012',
  'd1f1aaaa-0000-4000-8000-000000000004',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000005',
  '2026-04-06'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '33 Oak Avenue',
  'W2 1JU',
  51.513, -0.3013,
  'private',
  12, 5, 7500,
  'In-house childminder network session',
  'completed',
  FALSE,
  '2026-03-07 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000013',
  'd1f1aaaa-0000-4000-8000-000000000004',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000005',
  '2026-05-13'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '33 Oak Avenue',
  'W5 5DB',
  51.513, -0.3013,
  'public',
  12, 7, 5500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-13 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000014',
  'd1f1aaaa-0000-4000-8000-000000000004',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000005',
  '2026-06-05'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '33 Oak Avenue',
  'W2 1JU',
  51.513, -0.3013,
  'public',
  12, 9, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-06 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000015',
  'd1f1aaaa-0000-4000-8000-000000000004',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000005',
  '2026-04-15'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '33 Oak Avenue',
  'W5 5DB',
  51.513, -0.3013,
  'public',
  12, 3, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-03-16 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000016',
  'd1f1aaaa-0000-4000-8000-000000000005',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000007',
  '2026-03-07'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '44 Oak Avenue',
  'E1 6AN',
  51.5174, -0.0593,
  'public',
  12, 5, 7500,
  NULL,
  'completed',
  FALSE,
  '2026-02-05 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000017',
  'd1f1aaaa-0000-4000-8000-000000000005',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000007',
  '2026-04-07'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '44 Oak Avenue',
  'E14 5AB',
  51.5174, -0.0593,
  'public',
  12, 6, 5500,
  NULL,
  'completed',
  FALSE,
  '2026-03-08 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000018',
  'd1f1aaaa-0000-4000-8000-000000000005',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000007',
  '2026-05-15'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '44 Oak Avenue',
  'E1 6AN',
  51.5174, -0.0593,
  'public',
  12, 4, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-15 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000019',
  'd1f1aaaa-0000-4000-8000-000000000005',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000007',
  '2026-06-06'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '44 Oak Avenue',
  'E14 5AB',
  51.5174, -0.0593,
  'public',
  12, 6, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-07 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000020',
  'd1f1aaaa-0000-4000-8000-000000000005',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000007',
  '2026-06-26'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '44 Oak Avenue',
  'E1 6AN',
  51.5174, -0.0593,
  'public',
  12, 9, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-27 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000021',
  'd1f1aaaa-0000-4000-8000-000000000006',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000009',
  '2026-03-06'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '55 Oak Avenue',
  'BS1 4ST',
  51.4545, -2.5879,
  'public',
  12, 7, 5500,
  NULL,
  'completed',
  FALSE,
  '2026-02-04 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000022',
  'd1f1aaaa-0000-4000-8000-000000000006',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000009',
  '2026-04-08'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '55 Oak Avenue',
  'BS8 1QU',
  51.4545, -2.5879,
  'public',
  12, 1, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-09 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000023',
  'd1f1aaaa-0000-4000-8000-000000000006',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000009',
  '2026-05-17'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '55 Oak Avenue',
  'BS1 4ST',
  51.4545, -2.5879,
  'public',
  12, 5, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-17 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000024',
  'd1f1aaaa-0000-4000-8000-000000000006',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000009',
  '2026-06-03'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '55 Oak Avenue',
  'BS8 1QU',
  51.4545, -2.5879,
  'public',
  12, 9, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-04 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000025',
  'd1f1aaaa-0000-4000-8000-000000000006',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000009',
  '2026-04-11'::date,
  '13:00:00'::time,
  '19:00'::time,
  'The Mill House Nursery',
  '55 Oak Avenue',
  'BS1 4ST',
  51.4545, -2.5879,
  'private',
  12, 12, 50000,
  'Private session for parent group at Bumble Bees Playgroup',
  'cancelled',
  FALSE,
  '2026-03-12 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'corporate-bespoke';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000026',
  'd1f1aaaa-0000-4000-8000-000000000007',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000011',
  '2026-03-05'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '66 Oak Avenue',
  'B1 1AA',
  52.4814, -1.9116,
  'private',
  12, 0, 9500,
  'Corporate booking - finance team training day',
  'completed',
  FALSE,
  '2026-02-03 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000027',
  'd1f1aaaa-0000-4000-8000-000000000007',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000011',
  '2026-04-09'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '66 Oak Avenue',
  'B16 8LX',
  52.4814, -1.9116,
  'public',
  12, 4, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-10 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000028',
  'd1f1aaaa-0000-4000-8000-000000000007',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000011',
  '2026-05-09'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '66 Oak Avenue',
  'B1 1AA',
  52.4814, -1.9116,
  'public',
  12, 5, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-09 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000029',
  'd1f1aaaa-0000-4000-8000-000000000007',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000011',
  '2026-06-04'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '66 Oak Avenue',
  'B16 8LX',
  52.4814, -1.9116,
  'public',
  12, 9, 7500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-05 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000030',
  'd1f1aaaa-0000-4000-8000-000000000007',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000011',
  '2026-06-28'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '66 Oak Avenue',
  'B1 1AA',
  52.4814, -1.9116,
  'public',
  12, 9, 5500,
  NULL,
  'completed',
  FALSE,
  '2026-05-29 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000031',
  'd1f1aaaa-0000-4000-8000-000000000008',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000013',
  '2026-03-04'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '77 Oak Avenue',
  'M1 1AE',
  53.4794, -2.2453,
  'public',
  12, 11, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-02-02 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000032',
  'd1f1aaaa-0000-4000-8000-000000000008',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000013',
  '2026-04-10'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '77 Oak Avenue',
  'M14 6JL',
  53.4794, -2.2453,
  'private',
  12, 11, 9500,
  'Nursery group at St Mary''s Pre-school',
  'completed',
  FALSE,
  '2026-03-11 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000033',
  'd1f1aaaa-0000-4000-8000-000000000008',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000013',
  '2026-05-11'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '77 Oak Avenue',
  'M1 1AE',
  53.4794, -2.2453,
  'public',
  12, 11, 7500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-11 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000034',
  'd1f1aaaa-0000-4000-8000-000000000008',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000013',
  '2026-06-05'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '77 Oak Avenue',
  'M14 6JL',
  53.4794, -2.2453,
  'public',
  12, 12, 5500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-06 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000035',
  'd1f1aaaa-0000-4000-8000-000000000008',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000013',
  '2026-04-07'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '77 Oak Avenue',
  'M1 1AE',
  53.4794, -2.2453,
  'public',
  12, 11, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-08 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000036',
  'd1f1aaaa-0000-4000-8000-000000000009',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000015',
  '2026-03-03'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '88 Oak Avenue',
  'LS1 4DY',
  53.7997, -1.5492,
  'public',
  12, 12, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-02-01 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000037',
  'd1f1aaaa-0000-4000-8000-000000000009',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000015',
  '2026-04-11'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '88 Oak Avenue',
  'LS6 1AN',
  53.7997, -1.5492,
  'public',
  12, 12, 7500,
  NULL,
  'completed',
  FALSE,
  '2026-03-12 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000038',
  'd1f1aaaa-0000-4000-8000-000000000009',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000015',
  '2026-05-13'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '88 Oak Avenue',
  'LS1 4DY',
  53.7997, -1.5492,
  'public',
  12, 12, 5500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-13 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000039',
  'd1f1aaaa-0000-4000-8000-000000000009',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000015',
  '2026-06-06'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '88 Oak Avenue',
  'LS6 1AN',
  53.7997, -1.5492,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-07 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000040',
  'd1f1aaaa-0000-4000-8000-000000000009',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000015',
  '2026-06-30'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '88 Oak Avenue',
  'LS1 4DY',
  53.7997, -1.5492,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-31 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000041',
  'd1f1aaaa-0000-4000-8000-000000000010',
  ct.id,
  NULL,
  '2026-03-02'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '99 Oak Avenue',
  'NE1 5DF',
  54.9783, -1.6178,
  'public',
  12, 12, 7500,
  NULL,
  'completed',
  FALSE,
  '2026-01-31 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000042',
  'd1f1aaaa-0000-4000-8000-000000000010',
  ct.id,
  NULL,
  '2026-04-12'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '99 Oak Avenue',
  'NE2 1AA',
  54.9783, -1.6178,
  'public',
  12, 12, 5500,
  NULL,
  'completed',
  FALSE,
  '2026-03-13 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000043',
  'd1f1aaaa-0000-4000-8000-000000000010',
  ct.id,
  NULL,
  '2026-05-15'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '99 Oak Avenue',
  'NE1 5DF',
  54.9783, -1.6178,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-15 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000044',
  'd1f1aaaa-0000-4000-8000-000000000010',
  ct.id,
  NULL,
  '2026-06-03'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '99 Oak Avenue',
  'NE2 1AA',
  54.9783, -1.6178,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-04 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000045',
  'd1f1aaaa-0000-4000-8000-000000000010',
  ct.id,
  NULL,
  '2026-04-03'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '99 Oak Avenue',
  'NE1 5DF',
  54.9783, -1.6178,
  'private',
  12, 12, 50000,
  'Booking for The Little Acorns nursery staff',
  'scheduled',
  FALSE,
  '2026-03-04 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'corporate-bespoke';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000046',
  'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000017',
  '2026-03-01'::date,
  '14:00:00'::time,
  '16:00'::time,
  'Town Hall Function Room',
  '110 Oak Avenue',
  'CF10 1BH',
  51.4837, -3.1681,
  'public',
  12, 12, 5500,
  NULL,
  'completed',
  FALSE,
  '2026-01-30 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-2hr';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000047',
  'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000017',
  '2026-04-13'::date,
  '09:00:00'::time,
  '15:00'::time,
  'Daisy Studio',
  '110 Oak Avenue',
  'CF24 0AA',
  51.4837, -3.1681,
  'public',
  12, 12, 9500,
  NULL,
  'completed',
  FALSE,
  '2026-03-14 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'baby-child-full-day';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000048',
  'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000017',
  '2026-05-17'::date,
  '10:00:00'::time,
  '16:00'::time,
  'St Mary''s Community Hall',
  '110 Oak Avenue',
  'CF10 1BH',
  51.4837, -3.1681,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-04-17 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'paediatric-aow';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000049',
  'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000017',
  '2026-06-04'::date,
  '11:00:00'::time,
  '17:00'::time,
  'Acorn Pre-school',
  '110 Oak Avenue',
  'CF24 0AA',
  51.4837, -3.1681,
  'public',
  12, 12, 9500,
  NULL,
  'scheduled',
  FALSE,
  '2026-05-05 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'emergency-paediatric';

INSERT INTO da_course_instances (
  id, franchisee_id, template_id, territory_id,
  event_date, start_time, end_time,
  venue_name, venue_address, venue_postcode, lat, lng,
  visibility, capacity, spots_remaining, price_pence,
  bespoke_details, status, out_of_territory, created_at
) SELECT
  'd1f3cccc-0000-4000-8000-000000000050',
  'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  ct.id,
  'd1f2bbbb-0000-4000-8000-000000000017',
  '2026-07-02'::date,
  '13:00:00'::time,
  '16:00'::time,
  'The Mill House Nursery',
  '110 Oak Avenue',
  'CF10 1BH',
  51.4837, -3.1681,
  'public',
  12, 12, 7500,
  NULL,
  'cancelled',
  FALSE,
  '2026-06-02 00:00:00+00'::timestamptz
FROM da_course_templates ct WHERE ct.slug = 'blended-learning';

-- 6. Ticket types (Single / Couple / Family / corporate group).
INSERT INTO da_ticket_types (id, course_instance_id, name, price_pence, seats_consumed, max_available, sort_order) VALUES
  ('d1f4dddd-0000-4000-8000-000000000011', 'd1f3cccc-0000-4000-8000-000000000001', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000012', 'd1f3cccc-0000-4000-8000-000000000001', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000013', 'd1f3cccc-0000-4000-8000-000000000001', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000021', 'd1f3cccc-0000-4000-8000-000000000002', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000022', 'd1f3cccc-0000-4000-8000-000000000002', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000023', 'd1f3cccc-0000-4000-8000-000000000002', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000031', 'd1f3cccc-0000-4000-8000-000000000003', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000032', 'd1f3cccc-0000-4000-8000-000000000003', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000033', 'd1f3cccc-0000-4000-8000-000000000003', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000041', 'd1f3cccc-0000-4000-8000-000000000004', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000042', 'd1f3cccc-0000-4000-8000-000000000004', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000051', 'd1f3cccc-0000-4000-8000-000000000005', 'Group Booking', 50000, 12, 1, 0),
  ('d1f4dddd-0000-4000-8000-000000000061', 'd1f3cccc-0000-4000-8000-000000000006', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000062', 'd1f3cccc-0000-4000-8000-000000000006', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000063', 'd1f3cccc-0000-4000-8000-000000000006', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000071', 'd1f3cccc-0000-4000-8000-000000000007', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000072', 'd1f3cccc-0000-4000-8000-000000000007', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000073', 'd1f3cccc-0000-4000-8000-000000000007', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000081', 'd1f3cccc-0000-4000-8000-000000000008', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000082', 'd1f3cccc-0000-4000-8000-000000000008', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000091', 'd1f3cccc-0000-4000-8000-000000000009', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000092', 'd1f3cccc-0000-4000-8000-000000000009', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000101', 'd1f3cccc-0000-4000-8000-000000000010', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000102', 'd1f3cccc-0000-4000-8000-000000000010', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000103', 'd1f3cccc-0000-4000-8000-000000000010', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000111', 'd1f3cccc-0000-4000-8000-000000000011', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000112', 'd1f3cccc-0000-4000-8000-000000000011', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000113', 'd1f3cccc-0000-4000-8000-000000000011', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000121', 'd1f3cccc-0000-4000-8000-000000000012', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000122', 'd1f3cccc-0000-4000-8000-000000000012', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000131', 'd1f3cccc-0000-4000-8000-000000000013', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000132', 'd1f3cccc-0000-4000-8000-000000000013', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000141', 'd1f3cccc-0000-4000-8000-000000000014', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000142', 'd1f3cccc-0000-4000-8000-000000000014', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000143', 'd1f3cccc-0000-4000-8000-000000000014', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000151', 'd1f3cccc-0000-4000-8000-000000000015', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000152', 'd1f3cccc-0000-4000-8000-000000000015', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000153', 'd1f3cccc-0000-4000-8000-000000000015', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000161', 'd1f3cccc-0000-4000-8000-000000000016', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000162', 'd1f3cccc-0000-4000-8000-000000000016', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000171', 'd1f3cccc-0000-4000-8000-000000000017', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000172', 'd1f3cccc-0000-4000-8000-000000000017', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000181', 'd1f3cccc-0000-4000-8000-000000000018', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000182', 'd1f3cccc-0000-4000-8000-000000000018', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000183', 'd1f3cccc-0000-4000-8000-000000000018', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000191', 'd1f3cccc-0000-4000-8000-000000000019', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000192', 'd1f3cccc-0000-4000-8000-000000000019', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000193', 'd1f3cccc-0000-4000-8000-000000000019', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000201', 'd1f3cccc-0000-4000-8000-000000000020', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000202', 'd1f3cccc-0000-4000-8000-000000000020', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000203', 'd1f3cccc-0000-4000-8000-000000000020', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000211', 'd1f3cccc-0000-4000-8000-000000000021', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000212', 'd1f3cccc-0000-4000-8000-000000000021', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000221', 'd1f3cccc-0000-4000-8000-000000000022', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000222', 'd1f3cccc-0000-4000-8000-000000000022', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000223', 'd1f3cccc-0000-4000-8000-000000000022', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000231', 'd1f3cccc-0000-4000-8000-000000000023', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000232', 'd1f3cccc-0000-4000-8000-000000000023', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000233', 'd1f3cccc-0000-4000-8000-000000000023', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000241', 'd1f3cccc-0000-4000-8000-000000000024', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000242', 'd1f3cccc-0000-4000-8000-000000000024', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000243', 'd1f3cccc-0000-4000-8000-000000000024', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000251', 'd1f3cccc-0000-4000-8000-000000000025', 'Group Booking', 50000, 12, 1, 0),
  ('d1f4dddd-0000-4000-8000-000000000261', 'd1f3cccc-0000-4000-8000-000000000026', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000262', 'd1f3cccc-0000-4000-8000-000000000026', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000263', 'd1f3cccc-0000-4000-8000-000000000026', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000271', 'd1f3cccc-0000-4000-8000-000000000027', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000272', 'd1f3cccc-0000-4000-8000-000000000027', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000273', 'd1f3cccc-0000-4000-8000-000000000027', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000281', 'd1f3cccc-0000-4000-8000-000000000028', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000282', 'd1f3cccc-0000-4000-8000-000000000028', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000283', 'd1f3cccc-0000-4000-8000-000000000028', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000291', 'd1f3cccc-0000-4000-8000-000000000029', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000292', 'd1f3cccc-0000-4000-8000-000000000029', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000301', 'd1f3cccc-0000-4000-8000-000000000030', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000302', 'd1f3cccc-0000-4000-8000-000000000030', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000311', 'd1f3cccc-0000-4000-8000-000000000031', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000312', 'd1f3cccc-0000-4000-8000-000000000031', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000313', 'd1f3cccc-0000-4000-8000-000000000031', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000321', 'd1f3cccc-0000-4000-8000-000000000032', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000322', 'd1f3cccc-0000-4000-8000-000000000032', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000323', 'd1f3cccc-0000-4000-8000-000000000032', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000331', 'd1f3cccc-0000-4000-8000-000000000033', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000332', 'd1f3cccc-0000-4000-8000-000000000033', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000341', 'd1f3cccc-0000-4000-8000-000000000034', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000342', 'd1f3cccc-0000-4000-8000-000000000034', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000351', 'd1f3cccc-0000-4000-8000-000000000035', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000352', 'd1f3cccc-0000-4000-8000-000000000035', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000353', 'd1f3cccc-0000-4000-8000-000000000035', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000361', 'd1f3cccc-0000-4000-8000-000000000036', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000362', 'd1f3cccc-0000-4000-8000-000000000036', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000363', 'd1f3cccc-0000-4000-8000-000000000036', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000371', 'd1f3cccc-0000-4000-8000-000000000037', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000372', 'd1f3cccc-0000-4000-8000-000000000037', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000381', 'd1f3cccc-0000-4000-8000-000000000038', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000382', 'd1f3cccc-0000-4000-8000-000000000038', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000391', 'd1f3cccc-0000-4000-8000-000000000039', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000392', 'd1f3cccc-0000-4000-8000-000000000039', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000393', 'd1f3cccc-0000-4000-8000-000000000039', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000401', 'd1f3cccc-0000-4000-8000-000000000040', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000402', 'd1f3cccc-0000-4000-8000-000000000040', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000403', 'd1f3cccc-0000-4000-8000-000000000040', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000411', 'd1f3cccc-0000-4000-8000-000000000041', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000412', 'd1f3cccc-0000-4000-8000-000000000041', 'Couple', 15000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000421', 'd1f3cccc-0000-4000-8000-000000000042', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000422', 'd1f3cccc-0000-4000-8000-000000000042', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000431', 'd1f3cccc-0000-4000-8000-000000000043', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000432', 'd1f3cccc-0000-4000-8000-000000000043', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000433', 'd1f3cccc-0000-4000-8000-000000000043', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000441', 'd1f3cccc-0000-4000-8000-000000000044', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000442', 'd1f3cccc-0000-4000-8000-000000000044', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000443', 'd1f3cccc-0000-4000-8000-000000000044', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000451', 'd1f3cccc-0000-4000-8000-000000000045', 'Group Booking', 50000, 12, 1, 0),
  ('d1f4dddd-0000-4000-8000-000000000461', 'd1f3cccc-0000-4000-8000-000000000046', 'Single', 5500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000462', 'd1f3cccc-0000-4000-8000-000000000046', 'Couple', 11000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000471', 'd1f3cccc-0000-4000-8000-000000000047', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000472', 'd1f3cccc-0000-4000-8000-000000000047', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000473', 'd1f3cccc-0000-4000-8000-000000000047', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000481', 'd1f3cccc-0000-4000-8000-000000000048', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000482', 'd1f3cccc-0000-4000-8000-000000000048', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000483', 'd1f3cccc-0000-4000-8000-000000000048', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000491', 'd1f3cccc-0000-4000-8000-000000000049', 'Single', 9500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000492', 'd1f3cccc-0000-4000-8000-000000000049', 'Couple', 19000, 2, NULL, 1),
  ('d1f4dddd-0000-4000-8000-000000000493', 'd1f3cccc-0000-4000-8000-000000000049', 'Family', 38000, 4, NULL, 2),
  ('d1f4dddd-0000-4000-8000-000000000501', 'd1f3cccc-0000-4000-8000-000000000050', 'Single', 7500, 1, NULL, 0),
  ('d1f4dddd-0000-4000-8000-000000000502', 'd1f3cccc-0000-4000-8000-000000000050', 'Couple', 15000, 2, NULL, 1);

-- 7. Bookings - 100 total, distributed across last 6 months.
-- booking_reference uses S-prefix to avoid collision with the live sequence (which already burned 1-12).
-- Sequence is not reset; new app bookings will continue from current_seq+1.
INSERT INTO da_bookings (id, booking_reference, course_instance_id, franchisee_id, customer_id, ticket_type_id, quantity, total_price_pence, payment_status, stripe_payment_intent_id, stripe_checkout_session_id, booking_status, cancellation_reason, refund_amount_pence, notes, created_at) VALUES
  ('d1f6ffff-0000-4000-8000-000000000001', 'DA-2026-00001-S1', 'd1f3cccc-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000002', 'd1f4dddd-0000-4000-8000-000000000011', 1, 9500, 'paid', 'pi_seed_1', 'cs_seed_1', 'attended', NULL, 0, 'seed-dev', '2026-04-01 10:00:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000002', 'DA-2026-00001-S2', 'd1f3cccc-0000-4000-8000-000000000002', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000003', 'd1f4dddd-0000-4000-8000-000000000021', 1, 9500, 'paid', 'pi_seed_2', 'cs_seed_2', 'attended', NULL, 0, 'seed-dev', '2026-04-02 11:07:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000003', 'DA-2026-00001-S3', 'd1f3cccc-0000-4000-8000-000000000003', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000004', 'd1f4dddd-0000-4000-8000-000000000031', 1, 9500, 'paid', 'pi_seed_3', 'cs_seed_3', 'confirmed', NULL, 0, 'seed-dev', '2026-04-03 12:14:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000004', 'DA-2026-00001-S4', 'd1f3cccc-0000-4000-8000-000000000004', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000005', 'd1f4dddd-0000-4000-8000-000000000041', 1, 7500, 'paid', 'pi_seed_4', 'cs_seed_4', 'confirmed', NULL, 0, 'seed-dev', '2026-04-04 13:21:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000005', 'DA-2026-00001-S5', 'd1f3cccc-0000-4000-8000-000000000005', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000006', 'd1f4dddd-0000-4000-8000-000000000051', 1, 50000, 'paid', 'pi_seed_5', 'cs_seed_5', 'attended', NULL, 0, 'seed-dev', '2026-04-05 14:28:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000006', 'DA-2026-00002-S6', 'd1f3cccc-0000-4000-8000-000000000006', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000007', 'd1f4dddd-0000-4000-8000-000000000062', 1, 19000, 'paid', 'pi_seed_6', 'cs_seed_6', 'attended', NULL, 0, 'seed-dev', '2026-04-06 15:35:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000007', 'DA-2026-00002-S7', 'd1f3cccc-0000-4000-8000-000000000007', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000008', 'd1f4dddd-0000-4000-8000-000000000072', 1, 19000, 'paid', 'pi_seed_7', 'cs_seed_7', 'no_show', NULL, 0, 'seed-dev', '2026-04-07 16:42:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000008', 'DA-2026-00002-S8', 'd1f3cccc-0000-4000-8000-000000000008', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000009', 'd1f4dddd-0000-4000-8000-000000000082', 1, 15000, 'paid', 'pi_seed_8', 'cs_seed_8', 'confirmed', NULL, 0, 'seed-dev', '2026-04-08 17:49:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000009', 'DA-2026-00002-S9', 'd1f3cccc-0000-4000-8000-000000000009', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000010', 'd1f4dddd-0000-4000-8000-000000000092', 1, 11000, 'paid', 'pi_seed_9', 'cs_seed_9', 'confirmed', NULL, 0, 'seed-dev', '2026-04-09 10:56:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000010', 'DA-2026-00002-S10', 'd1f3cccc-0000-4000-8000-000000000010', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000011', 'd1f4dddd-0000-4000-8000-000000000102', 1, 19000, 'paid', 'pi_seed_10', 'cs_seed_10', 'attended', NULL, 0, 'seed-dev', '2026-04-10 11:03:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000011', 'DA-2026-00003-S11', 'd1f3cccc-0000-4000-8000-000000000011', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000012', 'd1f4dddd-0000-4000-8000-000000000112', 1, 19000, 'manual', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-04-11 12:10:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000012', 'DA-2026-00003-S12', 'd1f3cccc-0000-4000-8000-000000000012', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000013', 'd1f4dddd-0000-4000-8000-000000000122', 1, 15000, 'paid', 'pi_seed_12', 'cs_seed_12', 'attended', NULL, 0, 'seed-dev', '2026-04-12 13:17:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000013', 'DA-2026-00003-S13', 'd1f3cccc-0000-4000-8000-000000000013', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000014', 'd1f4dddd-0000-4000-8000-000000000132', 1, 11000, 'paid', 'pi_seed_13', 'cs_seed_13', 'confirmed', NULL, 0, 'seed-dev', '2026-04-13 14:24:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000014', 'DA-2026-00003-S14', 'd1f3cccc-0000-4000-8000-000000000014', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000015', 'd1f4dddd-0000-4000-8000-000000000142', 1, 19000, 'pending', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-04-14 15:31:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000015', 'DA-2026-00003-S15', 'd1f3cccc-0000-4000-8000-000000000015', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000016', 'd1f4dddd-0000-4000-8000-000000000153', 1, 38000, 'pending', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-04-15 16:38:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000016', 'DA-2026-00004-S16', 'd1f3cccc-0000-4000-8000-000000000016', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000017', 'd1f4dddd-0000-4000-8000-000000000161', 1, 7500, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-04-16 17:45:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000017', 'DA-2026-00004-S17', 'd1f3cccc-0000-4000-8000-000000000017', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000018', 'd1f4dddd-0000-4000-8000-000000000171', 1, 5500, 'failed', NULL, NULL, 'no_show', NULL, 0, 'seed-dev', '2026-04-17 10:52:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000018', 'DA-2026-00004-S18', 'd1f3cccc-0000-4000-8000-000000000018', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000019', 'd1f4dddd-0000-4000-8000-000000000183', 1, 38000, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-04-18 11:59:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000019', 'DA-2026-00004-S19', 'd1f3cccc-0000-4000-8000-000000000019', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000020', 'd1f4dddd-0000-4000-8000-000000000193', 1, 38000, 'paid', 'pi_seed_19', 'cs_seed_19', 'confirmed', NULL, 0, 'seed-dev', '2026-04-19 12:06:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000020', 'DA-2026-00004-S20', 'd1f3cccc-0000-4000-8000-000000000020', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000021', 'd1f4dddd-0000-4000-8000-000000000201', 1, 9500, 'paid', 'pi_seed_20', 'cs_seed_20', 'confirmed', NULL, 0, 'seed-dev', '2026-04-20 13:13:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000021', 'DA-2026-00005-S21', 'd1f3cccc-0000-4000-8000-000000000021', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000022', 'd1f4dddd-0000-4000-8000-000000000211', 1, 5500, 'paid', 'pi_seed_21', 'cs_seed_21', 'attended', NULL, 0, 'seed-dev', '2026-04-21 14:20:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000022', 'DA-2026-00005-S22', 'd1f3cccc-0000-4000-8000-000000000022', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000023', 'd1f4dddd-0000-4000-8000-000000000221', 1, 9500, 'manual', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-04-22 15:27:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000023', 'DA-2026-00005-S23', 'd1f3cccc-0000-4000-8000-000000000023', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000024', 'd1f4dddd-0000-4000-8000-000000000231', 1, 9500, 'paid', 'pi_seed_23', 'cs_seed_23', 'confirmed', NULL, 0, 'seed-dev', '2026-04-23 16:34:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000024', 'DA-2026-00005-S24', 'd1f3cccc-0000-4000-8000-000000000024', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000025', 'd1f4dddd-0000-4000-8000-000000000241', 1, 9500, 'paid', 'pi_seed_24', 'cs_seed_24', 'confirmed', NULL, 0, 'seed-dev', '2026-04-24 17:41:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000025', 'DA-2026-00005-S25', 'd1f3cccc-0000-4000-8000-000000000025', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000026', 'd1f4dddd-0000-4000-8000-000000000251', 1, 50000, 'refunded', NULL, NULL, 'cancelled', 'Customer cancellation', 50000, 'seed-dev', '2026-04-25 10:48:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000026', 'DA-2026-00006-S26', 'd1f3cccc-0000-4000-8000-000000000026', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000027', 'd1f4dddd-0000-4000-8000-000000000262', 1, 19000, 'paid', 'pi_seed_26', 'cs_seed_26', 'attended', NULL, 0, 'seed-dev', '2026-04-26 11:55:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000027', 'DA-2026-00006-S27', 'd1f3cccc-0000-4000-8000-000000000027', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000028', 'd1f4dddd-0000-4000-8000-000000000272', 1, 19000, 'paid', 'pi_seed_27', 'cs_seed_27', 'no_show', NULL, 0, 'seed-dev', '2026-04-27 12:02:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000028', 'DA-2026-00006-S28', 'd1f3cccc-0000-4000-8000-000000000028', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000029', 'd1f4dddd-0000-4000-8000-000000000282', 1, 19000, 'paid', 'pi_seed_28', 'cs_seed_28', 'confirmed', NULL, 0, 'seed-dev', '2026-04-01 13:09:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000029', 'DA-2026-00006-S29', 'd1f3cccc-0000-4000-8000-000000000029', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000030', 'd1f4dddd-0000-4000-8000-000000000292', 1, 15000, 'paid', 'pi_seed_29', 'cs_seed_29', 'confirmed', NULL, 0, 'seed-dev', '2026-04-02 14:16:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000030', 'DA-2026-00006-S30', 'd1f3cccc-0000-4000-8000-000000000030', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000031', 'd1f4dddd-0000-4000-8000-000000000302', 1, 11000, 'paid', 'pi_seed_30', 'cs_seed_30', 'attended', NULL, 0, 'seed-dev', '2026-04-03 15:23:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000031', 'DA-2026-00001-S31', 'd1f3cccc-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000032', 'd1f4dddd-0000-4000-8000-000000000012', 1, 19000, 'paid', 'pi_seed_31', 'cs_seed_31', 'attended', NULL, 0, 'seed-dev', '2026-03-01 10:00:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000032', 'DA-2026-00001-S32', 'd1f3cccc-0000-4000-8000-000000000002', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000033', 'd1f4dddd-0000-4000-8000-000000000022', 1, 19000, 'paid', 'pi_seed_32', 'cs_seed_32', 'attended', NULL, 0, 'seed-dev', '2026-03-02 11:07:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000033', 'DA-2026-00001-S33', 'd1f3cccc-0000-4000-8000-000000000003', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000034', 'd1f4dddd-0000-4000-8000-000000000032', 1, 19000, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-03 12:14:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000034', 'DA-2026-00001-S34', 'd1f3cccc-0000-4000-8000-000000000004', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000035', 'd1f4dddd-0000-4000-8000-000000000042', 1, 15000, 'failed', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-04 13:21:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000035', 'DA-2026-00001-S35', 'd1f3cccc-0000-4000-8000-000000000005', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000036', 'd1f4dddd-0000-4000-8000-000000000051', 1, 50000, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-03-05 14:28:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000036', 'DA-2026-00002-S36', 'd1f3cccc-0000-4000-8000-000000000006', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000037', 'd1f4dddd-0000-4000-8000-000000000063', 1, 38000, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-03-06 15:35:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000037', 'DA-2026-00002-S37', 'd1f3cccc-0000-4000-8000-000000000007', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000038', 'd1f4dddd-0000-4000-8000-000000000073', 1, 38000, 'pending', NULL, NULL, 'no_show', NULL, 0, 'seed-dev', '2026-03-07 16:42:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000038', 'DA-2026-00002-S38', 'd1f3cccc-0000-4000-8000-000000000008', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000039', 'd1f4dddd-0000-4000-8000-000000000081', 1, 7500, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-08 17:49:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000039', 'DA-2026-00002-S39', 'd1f3cccc-0000-4000-8000-000000000009', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000040', 'd1f4dddd-0000-4000-8000-000000000091', 1, 5500, 'paid', 'pi_seed_39', 'cs_seed_39', 'confirmed', NULL, 0, 'seed-dev', '2026-03-09 10:56:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000040', 'DA-2026-00002-S40', 'd1f3cccc-0000-4000-8000-000000000010', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000041', 'd1f4dddd-0000-4000-8000-000000000101', 1, 9500, 'paid', 'pi_seed_40', 'cs_seed_40', 'attended', NULL, 0, 'seed-dev', '2026-03-10 11:03:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000041', 'DA-2026-00003-S41', 'd1f3cccc-0000-4000-8000-000000000011', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000042', 'd1f4dddd-0000-4000-8000-000000000111', 1, 9500, 'paid', 'pi_seed_41', 'cs_seed_41', 'attended', NULL, 0, 'seed-dev', '2026-03-11 12:10:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000042', 'DA-2026-00003-S42', 'd1f3cccc-0000-4000-8000-000000000012', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000043', 'd1f4dddd-0000-4000-8000-000000000121', 1, 7500, 'paid', 'pi_seed_42', 'cs_seed_42', 'attended', NULL, 0, 'seed-dev', '2026-03-12 13:17:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000043', 'DA-2026-00003-S43', 'd1f3cccc-0000-4000-8000-000000000013', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000044', 'd1f4dddd-0000-4000-8000-000000000131', 1, 5500, 'paid', 'pi_seed_43', 'cs_seed_43', 'confirmed', NULL, 0, 'seed-dev', '2026-03-13 14:24:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000044', 'DA-2026-00003-S44', 'd1f3cccc-0000-4000-8000-000000000014', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000045', 'd1f4dddd-0000-4000-8000-000000000141', 1, 9500, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-14 15:31:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000045', 'DA-2026-00003-S45', 'd1f3cccc-0000-4000-8000-000000000015', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000046', 'd1f4dddd-0000-4000-8000-000000000151', 1, 9500, 'paid', 'pi_seed_45', 'cs_seed_45', 'confirmed', NULL, 0, 'seed-dev', '2026-03-15 16:38:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000046', 'DA-2026-00004-S46', 'd1f3cccc-0000-4000-8000-000000000016', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000047', 'd1f4dddd-0000-4000-8000-000000000162', 1, 15000, 'paid', 'pi_seed_46', 'cs_seed_46', 'attended', NULL, 0, 'seed-dev', '2026-03-16 17:45:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000047', 'DA-2026-00004-S47', 'd1f3cccc-0000-4000-8000-000000000017', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000048', 'd1f4dddd-0000-4000-8000-000000000172', 1, 11000, 'paid', 'pi_seed_47', 'cs_seed_47', 'no_show', NULL, 0, 'seed-dev', '2026-03-17 10:52:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000048', 'DA-2026-00004-S48', 'd1f3cccc-0000-4000-8000-000000000018', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000049', 'd1f4dddd-0000-4000-8000-000000000182', 1, 19000, 'paid', 'pi_seed_48', 'cs_seed_48', 'confirmed', NULL, 0, 'seed-dev', '2026-03-18 11:59:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000049', 'DA-2026-00004-S49', 'd1f3cccc-0000-4000-8000-000000000019', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000050', 'd1f4dddd-0000-4000-8000-000000000192', 1, 19000, 'paid', 'pi_seed_49', 'cs_seed_49', 'confirmed', NULL, 0, 'seed-dev', '2026-03-19 12:06:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000050', 'DA-2026-00004-S50', 'd1f3cccc-0000-4000-8000-000000000020', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000051', 'd1f4dddd-0000-4000-8000-000000000202', 1, 19000, 'paid', 'pi_seed_50', 'cs_seed_50', 'confirmed', NULL, 0, 'seed-dev', '2026-03-20 13:13:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000051', 'DA-2026-00005-S51', 'd1f3cccc-0000-4000-8000-000000000021', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000052', 'd1f4dddd-0000-4000-8000-000000000212', 1, 11000, 'paid', 'pi_seed_51', 'cs_seed_51', 'attended', NULL, 0, 'seed-dev', '2026-03-21 14:20:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000052', 'DA-2026-00005-S52', 'd1f3cccc-0000-4000-8000-000000000022', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000053', 'd1f4dddd-0000-4000-8000-000000000222', 1, 19000, 'paid', 'pi_seed_52', 'cs_seed_52', 'attended', NULL, 0, 'seed-dev', '2026-03-22 15:27:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000053', 'DA-2026-00005-S53', 'd1f3cccc-0000-4000-8000-000000000023', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000054', 'd1f4dddd-0000-4000-8000-000000000232', 1, 19000, 'paid', 'pi_seed_53', 'cs_seed_53', 'confirmed', NULL, 0, 'seed-dev', '2026-03-23 16:34:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000054', 'DA-2026-00005-S54', 'd1f3cccc-0000-4000-8000-000000000024', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000055', 'd1f4dddd-0000-4000-8000-000000000242', 1, 19000, 'pending', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-24 17:41:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000055', 'DA-2026-00005-S55', 'd1f3cccc-0000-4000-8000-000000000025', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000056', 'd1f4dddd-0000-4000-8000-000000000251', 1, 50000, 'refunded', NULL, NULL, 'cancelled', 'Customer cancellation', 50000, 'seed-dev', '2026-03-25 10:48:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000056', 'DA-2026-00006-S56', 'd1f3cccc-0000-4000-8000-000000000026', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000057', 'd1f4dddd-0000-4000-8000-000000000263', 1, 38000, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-03-26 11:55:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000057', 'DA-2026-00006-S57', 'd1f3cccc-0000-4000-8000-000000000027', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000058', 'd1f4dddd-0000-4000-8000-000000000273', 1, 38000, 'pending', NULL, NULL, 'no_show', NULL, 0, 'seed-dev', '2026-03-27 12:02:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000058', 'DA-2026-00006-S58', 'd1f3cccc-0000-4000-8000-000000000028', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000059', 'd1f4dddd-0000-4000-8000-000000000283', 1, 38000, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-03-01 13:09:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000059', 'DA-2026-00006-S59', 'd1f3cccc-0000-4000-8000-000000000029', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000060', 'd1f4dddd-0000-4000-8000-000000000291', 1, 7500, 'paid', 'pi_seed_59', 'cs_seed_59', 'confirmed', NULL, 0, 'seed-dev', '2026-03-02 14:16:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000060', 'DA-2026-00006-S60', 'd1f3cccc-0000-4000-8000-000000000030', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000001', 'd1f4dddd-0000-4000-8000-000000000301', 1, 5500, 'paid', 'pi_seed_60', 'cs_seed_60', 'attended', NULL, 0, 'seed-dev', '2026-03-03 15:23:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000061', 'DA-2026-00001-S61', 'd1f3cccc-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000002', 'd1f4dddd-0000-4000-8000-000000000011', 1, 9500, 'paid', 'pi_seed_61', 'cs_seed_61', 'attended', NULL, 0, 'seed-dev', '2026-02-01 10:00:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000062', 'DA-2026-00001-S62', 'd1f3cccc-0000-4000-8000-000000000002', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000003', 'd1f4dddd-0000-4000-8000-000000000021', 1, 9500, 'paid', 'pi_seed_62', 'cs_seed_62', 'attended', NULL, 0, 'seed-dev', '2026-02-02 11:07:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000063', 'DA-2026-00001-S63', 'd1f3cccc-0000-4000-8000-000000000003', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000004', 'd1f4dddd-0000-4000-8000-000000000031', 1, 9500, 'paid', 'pi_seed_63', 'cs_seed_63', 'confirmed', NULL, 0, 'seed-dev', '2026-02-03 12:14:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000064', 'DA-2026-00001-S64', 'd1f3cccc-0000-4000-8000-000000000005', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000005', 'd1f4dddd-0000-4000-8000-000000000051', 1, 50000, 'paid', 'pi_seed_64', 'cs_seed_64', 'attended', NULL, 0, 'seed-dev', '2026-02-04 13:21:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000065', 'DA-2026-00002-S65', 'd1f3cccc-0000-4000-8000-000000000006', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000006', 'd1f4dddd-0000-4000-8000-000000000061', 1, 9500, 'paid', 'pi_seed_65', 'cs_seed_65', 'attended', NULL, 0, 'seed-dev', '2026-02-05 14:28:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000066', 'DA-2026-00002-S66', 'd1f3cccc-0000-4000-8000-000000000007', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000007', 'd1f4dddd-0000-4000-8000-000000000072', 1, 19000, 'manual', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-02-06 15:35:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000067', 'DA-2026-00002-S67', 'd1f3cccc-0000-4000-8000-000000000008', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000008', 'd1f4dddd-0000-4000-8000-000000000082', 1, 15000, 'paid', 'pi_seed_67', 'cs_seed_67', 'confirmed', NULL, 0, 'seed-dev', '2026-02-07 16:42:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000068', 'DA-2026-00003-S68', 'd1f3cccc-0000-4000-8000-000000000011', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000009', 'd1f4dddd-0000-4000-8000-000000000112', 1, 19000, 'paid', 'pi_seed_68', 'cs_seed_68', 'attended', NULL, 0, 'seed-dev', '2026-02-08 17:49:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000069', 'DA-2026-00003-S69', 'd1f3cccc-0000-4000-8000-000000000012', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000010', 'd1f4dddd-0000-4000-8000-000000000122', 1, 15000, 'paid', 'pi_seed_69', 'cs_seed_69', 'confirmed', NULL, 0, 'seed-dev', '2026-02-09 10:56:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000070', 'DA-2026-00003-S70', 'd1f3cccc-0000-4000-8000-000000000013', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000011', 'd1f4dddd-0000-4000-8000-000000000132', 1, 11000, 'paid', 'pi_seed_70', 'cs_seed_70', 'confirmed', NULL, 0, 'seed-dev', '2026-02-10 11:03:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000071', 'DA-2026-00003-S71', 'd1f3cccc-0000-4000-8000-000000000015', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000012', 'd1f4dddd-0000-4000-8000-000000000152', 1, 19000, 'paid', 'pi_seed_71', 'cs_seed_71', 'confirmed', NULL, 0, 'seed-dev', '2026-02-11 12:10:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000072', 'DA-2026-00004-S72', 'd1f3cccc-0000-4000-8000-000000000016', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000013', 'd1f4dddd-0000-4000-8000-000000000162', 1, 15000, 'paid', 'pi_seed_72', 'cs_seed_72', 'attended', NULL, 0, 'seed-dev', '2026-02-12 13:17:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000073', 'DA-2026-00004-S73', 'd1f3cccc-0000-4000-8000-000000000017', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000014', 'd1f4dddd-0000-4000-8000-000000000172', 1, 11000, 'paid', 'pi_seed_73', 'cs_seed_73', 'attended', NULL, 0, 'seed-dev', '2026-02-13 14:24:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000074', 'DA-2026-00004-S74', 'd1f3cccc-0000-4000-8000-000000000018', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000015', 'd1f4dddd-0000-4000-8000-000000000182', 1, 19000, 'pending', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-02-14 15:31:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000075', 'DA-2026-00005-S75', 'd1f3cccc-0000-4000-8000-000000000021', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000016', 'd1f4dddd-0000-4000-8000-000000000211', 1, 5500, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-02-15 16:38:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000076', 'DA-2026-00005-S76', 'd1f3cccc-0000-4000-8000-000000000022', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000017', 'd1f4dddd-0000-4000-8000-000000000223', 1, 38000, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-02-16 17:45:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000077', 'DA-2026-00005-S77', 'd1f3cccc-0000-4000-8000-000000000023', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000018', 'd1f4dddd-0000-4000-8000-000000000233', 1, 38000, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-02-17 10:52:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000078', 'DA-2026-00005-S78', 'd1f3cccc-0000-4000-8000-000000000025', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000019', 'd1f4dddd-0000-4000-8000-000000000251', 1, 50000, 'manual', NULL, NULL, 'cancelled', 'Customer cancellation', 0, 'seed-dev', '2026-02-18 11:59:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000079', 'DA-2026-00006-S79', 'd1f3cccc-0000-4000-8000-000000000026', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000020', 'd1f4dddd-0000-4000-8000-000000000263', 1, 38000, 'paid', 'pi_seed_79', 'cs_seed_79', 'confirmed', NULL, 0, 'seed-dev', '2026-02-19 12:06:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000080', 'DA-2026-00006-S80', 'd1f3cccc-0000-4000-8000-000000000027', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000021', 'd1f4dddd-0000-4000-8000-000000000271', 1, 9500, 'paid', 'pi_seed_80', 'cs_seed_80', 'attended', NULL, 0, 'seed-dev', '2026-02-20 13:13:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000081', 'DA-2026-00006-S81', 'd1f3cccc-0000-4000-8000-000000000028', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000022', 'd1f4dddd-0000-4000-8000-000000000281', 1, 9500, 'paid', 'pi_seed_81', 'cs_seed_81', 'confirmed', NULL, 0, 'seed-dev', '2026-02-21 14:20:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000082', 'DA-2026-00007-S82', 'd1f3cccc-0000-4000-8000-000000000031', 'd1f1aaaa-0000-4000-8000-000000000008', 'd1f5eeee-0000-4000-8000-000000000023', 'd1f4dddd-0000-4000-8000-000000000311', 1, 9500, 'paid', 'pi_seed_82', 'cs_seed_82', 'attended', NULL, 0, 'seed-dev', '2026-02-22 15:27:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000083', 'DA-2026-00007-S83', 'd1f3cccc-0000-4000-8000-000000000032', 'd1f1aaaa-0000-4000-8000-000000000008', 'd1f5eeee-0000-4000-8000-000000000024', 'd1f4dddd-0000-4000-8000-000000000321', 1, 9500, 'paid', 'pi_seed_83', 'cs_seed_83', 'attended', NULL, 0, 'seed-dev', '2026-02-23 16:34:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000084', 'DA-2026-00007-S84', 'd1f3cccc-0000-4000-8000-000000000033', 'd1f1aaaa-0000-4000-8000-000000000008', 'd1f5eeee-0000-4000-8000-000000000025', 'd1f4dddd-0000-4000-8000-000000000331', 1, 7500, 'paid', 'pi_seed_84', 'cs_seed_84', 'confirmed', NULL, 0, 'seed-dev', '2026-02-24 17:41:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000085', 'DA-2026-00007-S85', 'd1f3cccc-0000-4000-8000-000000000035', 'd1f1aaaa-0000-4000-8000-000000000008', 'd1f5eeee-0000-4000-8000-000000000026', 'd1f4dddd-0000-4000-8000-000000000351', 1, 9500, 'paid', 'pi_seed_85', 'cs_seed_85', 'attended', NULL, 0, 'seed-dev', '2026-02-25 10:48:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000086', 'DA-2026-00001-S86', 'd1f3cccc-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000027', 'd1f4dddd-0000-4000-8000-000000000012', 1, 19000, 'paid', 'pi_seed_86', 'cs_seed_86', 'attended', NULL, 0, 'seed-dev', '2026-01-01 10:00:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000087', 'DA-2026-00001-S87', 'd1f3cccc-0000-4000-8000-000000000002', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000028', 'd1f4dddd-0000-4000-8000-000000000022', 1, 19000, 'paid', 'pi_seed_87', 'cs_seed_87', 'no_show', NULL, 0, 'seed-dev', '2026-01-02 11:07:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000088', 'DA-2026-00001-S88', 'd1f3cccc-0000-4000-8000-000000000005', 'd1f1aaaa-0000-4000-8000-000000000002', 'd1f5eeee-0000-4000-8000-000000000029', 'd1f4dddd-0000-4000-8000-000000000051', 1, 50000, 'manual', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-01-03 12:14:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000089', 'DA-2026-00002-S89', 'd1f3cccc-0000-4000-8000-000000000006', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000030', 'd1f4dddd-0000-4000-8000-000000000062', 1, 19000, 'paid', 'pi_seed_89', 'cs_seed_89', 'confirmed', NULL, 0, 'seed-dev', '2026-01-04 13:21:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000090', 'DA-2026-00002-S90', 'd1f3cccc-0000-4000-8000-000000000007', 'd1f1aaaa-0000-4000-8000-000000000003', 'd1f5eeee-0000-4000-8000-000000000031', 'd1f4dddd-0000-4000-8000-000000000072', 1, 19000, 'paid', 'pi_seed_90', 'cs_seed_90', 'attended', NULL, 0, 'seed-dev', '2026-01-05 14:28:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000091', 'DA-2026-00003-S91', 'd1f3cccc-0000-4000-8000-000000000011', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000032', 'd1f4dddd-0000-4000-8000-000000000112', 1, 19000, 'paid', 'pi_seed_91', 'cs_seed_91', 'attended', NULL, 0, 'seed-dev', '2026-01-06 15:35:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000092', 'DA-2026-00003-S92', 'd1f3cccc-0000-4000-8000-000000000012', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000033', 'd1f4dddd-0000-4000-8000-000000000122', 1, 15000, 'paid', 'pi_seed_92', 'cs_seed_92', 'attended', NULL, 0, 'seed-dev', '2026-01-07 16:42:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000093', 'DA-2026-00003-S93', 'd1f3cccc-0000-4000-8000-000000000015', 'd1f1aaaa-0000-4000-8000-000000000004', 'd1f5eeee-0000-4000-8000-000000000034', 'd1f4dddd-0000-4000-8000-000000000152', 1, 19000, 'paid', 'pi_seed_93', 'cs_seed_93', 'confirmed', NULL, 0, 'seed-dev', '2026-01-08 17:49:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000094', 'DA-2026-00004-S94', 'd1f3cccc-0000-4000-8000-000000000016', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000035', 'd1f4dddd-0000-4000-8000-000000000162', 1, 15000, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-01-09 10:56:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000095', 'DA-2026-00004-S95', 'd1f3cccc-0000-4000-8000-000000000017', 'd1f1aaaa-0000-4000-8000-000000000005', 'd1f5eeee-0000-4000-8000-000000000036', 'd1f4dddd-0000-4000-8000-000000000171', 1, 5500, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-01-10 11:03:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000096', 'DA-2026-00005-S96', 'd1f3cccc-0000-4000-8000-000000000021', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000037', 'd1f4dddd-0000-4000-8000-000000000211', 1, 5500, 'pending', NULL, NULL, 'attended', NULL, 0, 'seed-dev', '2026-01-11 12:10:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000097', 'DA-2026-00005-S97', 'd1f3cccc-0000-4000-8000-000000000022', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000038', 'd1f4dddd-0000-4000-8000-000000000223', 1, 38000, 'pending', NULL, NULL, 'no_show', NULL, 0, 'seed-dev', '2026-01-12 13:17:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000098', 'DA-2026-00005-S98', 'd1f3cccc-0000-4000-8000-000000000025', 'd1f1aaaa-0000-4000-8000-000000000006', 'd1f5eeee-0000-4000-8000-000000000039', 'd1f4dddd-0000-4000-8000-000000000251', 1, 50000, 'manual', NULL, NULL, 'cancelled', 'Customer cancellation', 0, 'seed-dev', '2026-01-13 14:24:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000099', 'DA-2026-00006-S99', 'd1f3cccc-0000-4000-8000-000000000026', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000040', 'd1f4dddd-0000-4000-8000-000000000263', 1, 38000, 'manual', NULL, NULL, 'confirmed', NULL, 0, 'seed-dev', '2026-01-14 15:31:00+00'::timestamptz),
  ('d1f6ffff-0000-4000-8000-000000000100', 'DA-2026-00006-S100', 'd1f3cccc-0000-4000-8000-000000000027', 'd1f1aaaa-0000-4000-8000-000000000007', 'd1f5eeee-0000-4000-8000-000000000041', 'd1f4dddd-0000-4000-8000-000000000271', 1, 9500, 'paid', 'pi_seed_100', 'cs_seed_100', 'attended', NULL, 0, 'seed-dev', '2026-01-15 16:38:00+00'::timestamptz);

-- 8. Interest forms (vacant-territory leads).
INSERT INTO da_interest_forms (id, postcode, num_attendees, preferred_dates, venue_preference, contact_name, contact_email, contact_phone, status, assigned_freelancer, notes, created_at) VALUES
  ('d1f70000-0000-4000-8000-000000000001', 'PL1 2DJ', 12, 'Saturday mornings, ideally next month', 'Community hall in city centre', 'Beth Carrington', 'beth.carrington@example.com', '07700900201', 'new', NULL, 'seed-dev. Plymouth parent group asking about full-day paediatric.', '2026-04-27 00:00:00+00'::timestamptz),
  ('d1f70000-0000-4000-8000-000000000002', 'AB10 1XL', 8, 'Weekends or evenings', 'Nursery or church hall', 'Ailsa MacDonald', 'ailsa.macdonald@example.com', '07700900202', 'contacted', 'Lucy Brown (Manchester)', 'seed-dev. Aberdeen childminder network - chasing for venue confirmation.', '2026-04-22 00:00:00+00'::timestamptz),
  ('d1f70000-0000-4000-8000-000000000003', 'EH1 3LL', 6, 'Any weekend in May', 'Small private venue', 'Iona Sutherland', 'iona.sutherland@example.com', '07700900203', 'declined', NULL, 'seed-dev. Group dispersed before we could schedule.', '2026-04-04 00:00:00+00'::timestamptz),
  ('d1f70000-0000-4000-8000-000000000004', 'PL4 7DY', 15, '14 or 21 June', 'Local primary school', 'Tom Reilly', 'tom.reilly@example.com', '07700900204', 'booked', 'David Owen (Newcastle)', 'seed-dev. Booked - invoice raised, course confirmed for 12 June.', '2026-04-15 00:00:00+00'::timestamptz);

-- 9. Activity log (30 narrative rows).
INSERT INTO da_activities (id, actor_type, actor_id, entity_type, entity_id, action, description, metadata, created_at) VALUES
  ('d1f81111-0000-4000-8000-000000000001', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000002', 'franchisee_created', 'Franchisee Ashley Carter created (number 0001)', NULL, '2026-04-15T18:00:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000002', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'territory', 'd1f2bbbb-0000-4000-8000-000000000001', 'territory_assigned', 'Territory SW1A assigned to Ashley Carter', NULL, '2026-04-16T18:07:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000003', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'territory', 'd1f2bbbb-0000-4000-8000-000000000002', 'territory_assigned', 'Territory SW4 assigned to Ashley Carter', NULL, '2026-04-16T18:14:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000004', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000003', 'franchisee_created', 'Franchisee Sarah Hughes created (number 0002)', NULL, '2026-04-17T18:21:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000005', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'territory', 'd1f2bbbb-0000-4000-8000-000000000003', 'territory_assigned', 'Territory NW1 assigned to Sarah Hughes', NULL, '2026-04-17T18:28:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000006', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'territory', 'd1f2bbbb-0000-4000-8000-000000000004', 'territory_assigned', 'Territory NW3 assigned to Sarah Hughes', NULL, '2026-04-17T18:35:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000007', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000004', 'franchisee_created', 'Franchisee Maria O''Connell created (number 0003)', NULL, '2026-04-18T18:42:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000008', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000005', 'franchisee_created', 'Franchisee Rachel Patel created (number 0004)', NULL, '2026-04-19T18:49:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000009', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000006', 'franchisee_created', 'Franchisee Emma Williams created (number 0005)', NULL, '2026-04-19T18:56:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000010', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000007', 'franchisee_created', 'Franchisee Charlotte Thomas created (number 0006)', NULL, '2026-04-20T18:03:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000011', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000002', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000001', 'course_instance_created', 'Course at SW1A 1AA on 2026-03-10 created', NULL, '2026-04-21T18:10:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000012', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000003', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000006', 'course_instance_created', 'Course at NW1 8XU on 2026-03-09 created', NULL, '2026-04-21T18:17:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000013', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000004', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000011', 'course_instance_created', 'Course at W5 5DB on 2026-03-08 created', NULL, '2026-04-22T18:24:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000014', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'template', '00000000-0000-0000-0000-000000000000', 'template_updated', 'Template "Paediatric First Aid (Award of Worth)" — description updated', NULL, '2026-04-22T18:31:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000015', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000008', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000036', 'course_instance_created', 'Course at LS1 4DY on 2026-03-03 created', NULL, '2026-04-23T18:38:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000016', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000006', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000021', 'course_instance_updated', 'Course at BS1 4ST on 2026-03-06 updated by franchisee — start_time, capacity', NULL, '2026-04-23T18:45:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000017', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'interest_form', 'd1f70000-0000-4000-8000-000000000002', 'interest_form_updated', 'Interest form for AB10 1XL — status changed from new to contacted', NULL, '2026-04-24T18:52:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000018', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000001', 'booking_confirmed', 'Booking DA-2026-00001-S1 confirmed', NULL, '2026-04-25T18:59:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000019', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000002', 'booking_confirmed', 'Booking DA-2026-00001-S2 confirmed', NULL, '2026-04-25T18:06:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000020', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000003', 'booking_confirmed', 'Booking DA-2026-00001-S3 confirmed', NULL, '2026-04-26T18:13:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000021', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000004', 'booking_confirmed', 'Booking DA-2026-00001-S4 confirmed', NULL, '2026-04-26T18:20:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000022', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000005', 'booking_confirmed', 'Booking DA-2026-00001-S5 confirmed', NULL, '2026-04-27T18:27:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000023', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000006', 'booking_confirmed', 'Booking DA-2026-00002-S6 confirmed', NULL, '2026-04-27T18:34:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000024', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000007', 'booking_confirmed', 'Booking DA-2026-00002-S7 confirmed', NULL, '2026-04-28T18:41:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000025', 'system', NULL, 'booking', 'd1f6ffff-0000-4000-8000-000000000008', 'booking_confirmed', 'Booking DA-2026-00002-S8 confirmed', NULL, '2026-04-28T18:48:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000026', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'interest_form', 'd1f70000-0000-4000-8000-000000000004', 'interest_form_updated', 'Interest form for PL4 7DY — status changed to booked', NULL, '2026-04-28T18:55:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000027', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000009', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000041', 'course_instance_created', 'Course at NE1 5DF on 2026-03-02 created', NULL, '2026-04-28T18:02:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000028', 'system', NULL, 'geocode', 'd1f2bbbb-0000-4000-8000-000000000019', 'geocode', 'Geocoded PL1 2DJ', NULL, '2026-04-29T18:09:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000029', 'hq', 'd1f1aaaa-0000-4000-8000-000000000001', 'interest_form', 'd1f70000-0000-4000-8000-000000000001', 'interest_form_updated', 'Interest form for PL1 2DJ - notes updated', NULL, '2026-04-29T18:16:00.000Z'::timestamptz),
  ('d1f81111-0000-4000-8000-000000000030', 'franchisee', 'd1f1aaaa-0000-4000-8000-000000000005', 'course_instance', 'd1f3cccc-0000-4000-8000-000000000016', 'course_instance_created', 'Course at E1 6AN on 2026-03-07 created', NULL, '2026-04-27T18:23:00.000Z'::timestamptz);

-- 10. Sample billing run from March 2026 (Lucy Brown).
INSERT INTO da_billing_runs (id, franchisee_id, billing_period_start, billing_period_end, territory_breakdown, total_base_fees_pence, total_percentage_fees_pence, total_due_pence, payment_status, retry_count, paid_at, notes, created_at) VALUES
  ('d1f92222-0000-4000-8000-000000000001', 'd1f1aaaa-0000-4000-8000-000000000008', '2026-03-01'::date, '2026-03-31'::date, '[{"territory_id":"d1f2bbbb-0000-4000-8000-000000000013","postcode_prefix":"M1","territory_name":"Manchester Centre","base_fee_pence":12000,"revenue_pence":156000,"percentage_fee_pence":15600,"fee_charged_pence":15600,"logic":"percentage_wins"},{"territory_id":"d1f2bbbb-0000-4000-8000-000000000014","postcode_prefix":"M14","territory_name":"Fallowfield","base_fee_pence":12000,"revenue_pence":95000,"percentage_fee_pence":9500,"fee_charged_pence":12000,"logic":"base_fee_wins"}]'::jsonb, 12000, 15600, 27600, 'paid', 0, '2026-03-28 10:00:00+00'::timestamptz, 'seed-dev. Sample run from March 2026.', '2026-03-28 09:00:00+00'::timestamptz);

COMMIT;

-- ============================================================
-- Summary of seeded counts (verify with: SELECT count(*) FROM <table>):
--   da_franchisees:       +10 (10 active non-HQ-or-test = 9 named + 1 F001 = 10)
--   da_territories:       +20 (17 active, 3 vacant = 85% coverage)
--   da_customers:         +60
--   da_course_instances:  +50
--   da_ticket_types:      +126
--   da_bookings:          +100 (April MTD: 30 bookings, £5365.00)
--   da_interest_forms:    +4
--   da_activities:        +30
--   da_billing_runs:      +1 (March 2026, Lucy Brown)
-- ============================================================