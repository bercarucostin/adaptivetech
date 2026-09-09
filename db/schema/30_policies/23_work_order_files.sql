-- work_order_files — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "clinic or lab members may insert file metadata" ON "public"."work_order_files";

CREATE POLICY "clinic or lab members may insert file metadata" ON "public"."work_order_files" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((uploaded_by_user_id = auth.uid()) AND (((clinic_organization_id IS NOT NULL) AND is_org_member(clinic_organization_id)) OR ((lab_organization_id IS NOT NULL) AND is_org_member(lab_organization_id)))));

DROP POLICY IF EXISTS "work order file metadata visible to involved organizations" ON "public"."work_order_files";

CREATE POLICY "work order file metadata visible to involved organizations" ON "public"."work_order_files" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((((clinic_organization_id IS NOT NULL) AND is_org_member(clinic_organization_id)) OR (shared_with_lab AND (lab_organization_id IS NOT NULL) AND is_org_member(lab_organization_id))));
