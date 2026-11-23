-- 074: each booking keeps the name it was made under.
--
-- A booking only pointed at da_customers, which is one row per email address
-- and takes the latest name on every new booking. So a manager booking two
-- staff members under one email showed the second name on both bookings
-- (Feola, 23 Nov 2026: Reigate Level 3, 21 Nov and 31 Jan).
--
-- booked_first_name / booked_last_name are written when the booking is made
-- and are what the portal, the CSV and the booking emails show. da_customers
-- stays the contact record (latest details). Existing bookings are filled from
-- the customer's current name, which is the best we hold for them.

alter table da_bookings add column if not exists booked_first_name text;
alter table da_bookings add column if not exists booked_last_name text;

update da_bookings b
   set booked_first_name = c.first_name,
       booked_last_name  = c.last_name
  from da_customers c
 where c.id = b.customer_id
   and b.booked_first_name is null
   and b.booked_last_name is null;

-- Personal data: gdpr-erasure deletes the customer's bookings outright, and
-- gdpr-subject-access includes these columns.
comment on column da_bookings.booked_first_name is 'Name given on this booking (074).';
comment on column da_bookings.booked_last_name is 'Name given on this booking (074).';
