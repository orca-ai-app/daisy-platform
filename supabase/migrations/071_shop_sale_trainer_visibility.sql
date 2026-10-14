-- 071_shop_sale_trainer_visibility.sql
--
-- Trainers were never told about a standalone online shop purchase and could
-- not see who bought. E-learning buyers are told their access details follow
-- "within 48 hours", and the trainer's team sets them up by hand on elearnhere,
-- so an untold trainer meant a buyer waiting indefinitely (six such sales by
-- 14 Oct 2026). Basket orders (shop items bought with a class, B6) were already
-- covered: the trainer's new_booking_notification lists the items.
--
-- 1. New transactional key 'product_sale_notification': the trainer's alert
--    for a standalone online shop order, queued by stripe-webhook next to the
--    buyer's product_purchase_confirmation and sent by send-emails.
-- 2. Trainers can READ the customers who bought from their shop, alongside the
--    existing bookings rule, so Merchandise > Sales can show the buyer.

-- Allow the new key. Recreated with every existing key (as in 066) plus the new one.
alter table da_email_sequences drop constraint if exists da_email_sequences_template_key_check;
alter table da_email_sequences add constraint da_email_sequences_template_key_check
  check (template_key = any (array[
    'post_course_welcome', 'recap_anaphylaxis', 'recap_choking', 'recap_head_injuries',
    'recap_cpr', 'recap_febrile_convulsions', 'recap_burns', 'quiz_general', 'refresher',
    'refresher_elearning_option', 'new_booking_notification', 'booking_confirmation',
    'medical_reminder', 'day_before_reminder', 'interest_form_hq', 'course_updated',
    'product_purchase_confirmation', 'fee_invoice', 'fee_chase_1', 'fee_chase_2', 'fee_failed',
    'thank_you', 'refresher_6w', 'refresher_3m', 'refresher_6m', 'refresher_9m',
    'refresher_12m', 'quiz_prompt', 'checkout_recovery', 'product_sale_notification'
  ]::text[]));

-- Read-only. Permissive policies are OR'd, so franchisee_read_own_customers
-- (customers with a booking for this trainer) is unchanged and this adds the
-- customers with a shop sale for this trainer. The da_product_sales subquery
-- runs under that table's own franchisee_own policy, which scopes it the same way.
drop policy if exists "franchisee_read_shop_customers" on da_customers;
create policy "franchisee_read_shop_customers" on da_customers
  for select using (
    id in (
      select customer_id from da_product_sales
      where franchisee_id = get_current_franchisee_id()
        and customer_id is not null
    )
  );
