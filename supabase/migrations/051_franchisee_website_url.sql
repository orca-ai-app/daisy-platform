-- 051: the franchisee's page on daisyfirstaid.com.
--
-- Jenni (27 Aug): course-finder results must hand the customer through to the
-- trainer's own page. The URL per trainer comes from Emma's final page list;
-- HQ fills it in, and anywhere it is null the finder simply shows no link.
ALTER TABLE da_franchisees ADD COLUMN IF NOT EXISTS website_url text;
