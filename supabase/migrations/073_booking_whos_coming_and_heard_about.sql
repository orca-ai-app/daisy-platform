-- November batch (approved by Jenni, 9 Oct 2026), shipped 21 Nov 2026.
--
-- N2 "Who's coming?" (Feola, TRI-0046/0047/0054/0086): optional free text on
-- the booking form for the names and emails of the people a booker is booking
-- for. Trainer-only booking information: never copied to Contacts, never used
-- for marketing, never sent to the email journey.
--
-- N1 "How did you hear about us?" (Hannah, TRI-0056): optional source on the
-- booking form, shown to the trainer and in the bookings export.
--
-- Both are stored on the order's first line only (lead booking) and stay null
-- for bookings a trainer adds themselves.

alter table da_bookings add column if not exists attendee_details text;
alter table da_bookings add column if not exists heard_about text;
alter table da_bookings add column if not exists heard_about_other text;

alter table da_bookings drop constraint if exists da_bookings_heard_about_check;
alter table da_bookings add constraint da_bookings_heard_about_check check (
  heard_about is null or heard_about in (
    'facebook',
    'instagram',
    'google',
    'daisy_website',
    'recommendation',
    'nursery_school_workplace',
    'been_before',
    'other'
  )
);

alter table da_bookings drop constraint if exists da_bookings_attendee_details_length;
alter table da_bookings add constraint da_bookings_attendee_details_length
  check (attendee_details is null or char_length(attendee_details) <= 2000);

alter table da_bookings drop constraint if exists da_bookings_heard_about_other_length;
alter table da_bookings add constraint da_bookings_heard_about_other_length
  check (heard_about_other is null or char_length(heard_about_other) <= 200);
