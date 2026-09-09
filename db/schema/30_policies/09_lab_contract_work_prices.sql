-- lab_contract_work_prices — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_contract_prices_management_write" ON "public"."lab_contract_work_prices";

CREATE POLICY "lab_contract_prices_management_write" ON "public"."lab_contract_work_prices" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_contract_prices_permission_read" ON "public"."lab_contract_work_prices";

CREATE POLICY "lab_contract_prices_permission_read" ON "public"."lab_contract_work_prices" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_role_permission(lab_organization_id, 'can_view_client_pricing'::text));
