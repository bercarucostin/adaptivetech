-- lab_patient_cases — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_patient_cases_management_read" ON "public"."lab_patient_cases";

CREATE POLICY "lab_patient_cases_management_read" ON "public"."lab_patient_cases" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_patient_cases_management_write" ON "public"."lab_patient_cases";

CREATE POLICY "lab_patient_cases_management_write" ON "public"."lab_patient_cases" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));
