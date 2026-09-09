-- lab_work_types — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_work_types_management_delete" ON "public"."lab_work_types";

CREATE POLICY "lab_work_types_management_delete" ON "public"."lab_work_types" AS PERMISSIVE FOR DELETE TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_work_types_management_insert" ON "public"."lab_work_types";

CREATE POLICY "lab_work_types_management_insert" ON "public"."lab_work_types" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_work_types_management_update" ON "public"."lab_work_types";

CREATE POLICY "lab_work_types_management_update" ON "public"."lab_work_types" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_work_types_member_read" ON "public"."lab_work_types";

CREATE POLICY "lab_work_types_member_read" ON "public"."lab_work_types" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_active_org_member(lab_organization_id));
