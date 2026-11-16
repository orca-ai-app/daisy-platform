-- 072_shop_delivery_address.sql
--
-- TRI-0084 (Feola): a customer who bought a book from a trainer's online shop
-- had to email their address afterwards, because checkout never asked for it.
-- A standalone online purchase of a physical item now collects a UK delivery
-- address on the Stripe payment page; stripe-webhook stores it here so the
-- trainer sees it on the "New shop order" email and in Merchandise > Sales.
--
-- Free text, one line per address line. NULL for in-person sales, e-learning,
-- items bought with a class (handed over on the day) and every older sale.
-- Covered by the table's existing franchisee_own RLS policy.

alter table da_product_sales add column if not exists delivery_address text;
