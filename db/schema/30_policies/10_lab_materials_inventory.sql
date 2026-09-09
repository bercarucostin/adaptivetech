-- lab_materials_inventory — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_materials_management_read" ON "public"."lab_materials_inventory";

CREATE POLICY "lab_materials_management_read" ON "public"."lab_materials_inventory" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_materials_management_write" ON "public"."lab_materials_inventory";

CREATE POLICY "lab_materials_management_write" ON "public"."lab_materials_inventory" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_materials_technician_read" ON "public"."lab_materials_inventory";

CREATE POLICY "lab_materials_technician_read" ON "public"."lab_materials_inventory" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Technician'::text]));
