-- lab_technician_costs — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_technician_costs_management_read" ON "public"."lab_technician_costs";

CREATE POLICY "lab_technician_costs_management_read" ON "public"."lab_technician_costs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_technician_costs_management_write" ON "public"."lab_technician_costs";

CREATE POLICY "lab_technician_costs_management_write" ON "public"."lab_technician_costs" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_technician_costs_own_read" ON "public"."lab_technician_costs";

CREATE POLICY "lab_technician_costs_own_read" ON "public"."lab_technician_costs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((has_role_permission(lab_organization_id, 'can_view_own_technician_cost'::text) AND (lower(TRIM(BOTH FROM COALESCE(tehnician, ''::text))) = lower(TRIM(BOTH FROM COALESCE(current_technician_name(), ''::text))))));
