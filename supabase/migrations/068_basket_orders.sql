-- 068_basket_orders.sql
--
-- B6 basket (Jenni approved 24 Sep, confirmed 5 Oct 2026, £600): one checkout
-- can hold several ticket types for a class plus the trainer's shop items.
--
-- One da_bookings row per ticket line, all sharing the Stripe checkout session.
-- The lines of a multi-line order share order_id, which is the LEAD line's own
-- id. A plain single-ticket booking keeps order_id NULL, so every existing row
-- and every old-style checkout is untouched.
--
-- Shop items bought in the same order are snapshotted on the lead line
-- (order_items) when the checkout starts, and written to da_product_sales by
-- stripe-webhook once paid, so an abandoned basket leaves no unpaid sale behind
-- and the recovery link can put the items back.
--
-- NOT APPLIED. Part of the October batch: apply with the release, before the
-- new create-checkout-session / stripe-webhook / send-emails are deployed (the
-- old functions never write these columns, so applying first is safe).

alter table da_bookings add column if not exists order_id uuid;
alter table da_bookings add column if not exists order_items jsonb;

comment on column da_bookings.order_id is
  'B6 basket: groups the ticket lines of one multi-line order. Equals the lead line''s id; NULL for a plain single booking.';
comment on column da_bookings.order_items is
  'B6 basket, lead line only: shop items in the order [{franchisee_product_id, product_id, name, kind, quantity, unit_price_pence, vat_rate}]. Written to da_product_sales on payment.';

create index if not exists idx_bookings_order on da_bookings (order_id) where order_id is not null;

-- Migration 049 made the checkout session unique per booking, which would
-- reject the second line of an order. Unique per (session, ticket type) keeps
-- the webhook's duplicate-delivery guard for single bookings (one row, one
-- ticket type) and still lets an order hold one row per ticket type.
drop index if exists idx_bookings_checkout_session;
create unique index if not exists idx_bookings_checkout_session_line
  on da_bookings (stripe_checkout_session_id, ticket_type_id)
  where stripe_checkout_session_id is not null;

-- Same for online shop sales (migration 044): an order can hold several items
-- on one session, but never the same item twice.
drop index if exists idx_product_sales_checkout_session;
create unique index if not exists idx_product_sales_checkout_session_item
  on da_product_sales (stripe_checkout_session_id, franchisee_product_id)
  where stripe_checkout_session_id is not null;
