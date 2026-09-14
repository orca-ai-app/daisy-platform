-- Attribute an interest/enquiry to a specific trainer, so the booking widget's
-- "Request a class" CTA on a franchisee page routes the enquiry to that trainer
-- (email) rather than only HQ. Nullable: vacant-territory enquiries still have no
-- franchisee and continue to notify HQ.
alter table public.da_interest_forms
  add column if not exists franchisee_id uuid
  references public.da_franchisees(id) on delete set null;

create index if not exists da_interest_forms_franchisee_id_idx
  on public.da_interest_forms(franchisee_id);

-- A franchisee "Request a class" enquiry has no postcode.
alter table public.da_interest_forms alter column postcode drop not null;
