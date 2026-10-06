-- 070_medical_declarations_read_only_for_franchisees.sql
--
-- Franchisees could UPDATE and DELETE their own medical declaration rows: the
-- franchisee_own policy covered every command. Nothing in the portal writes to
-- this table (submissions go through the submit-medical-declaration edge
-- function with the service role), so franchisees get read access only.
-- HQ keeps full access.
drop policy if exists franchisee_own on da_medical_declarations;
create policy franchisee_own on da_medical_declarations
  for select
  using (franchisee_id = get_current_franchisee_id());
