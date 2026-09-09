-- organization_relationships — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "either side may request relationship" ON "public"."organization_relationships";

CREATE POLICY "either side may request relationship" ON "public"."organization_relationships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_org_member(clinic_organization_id) OR is_org_member(lab_organization_id)));

DROP POLICY IF EXISTS "either side may update relationship" ON "public"."organization_relationships";

CREATE POLICY "either side may update relationship" ON "public"."organization_relationships" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((is_org_member(clinic_organization_id) OR is_org_member(lab_organization_id))) WITH CHECK ((is_org_member(clinic_organization_id) OR is_org_member(lab_organization_id)));

DROP POLICY IF EXISTS "relationship visible to either organization" ON "public"."organization_relationships";

CREATE POLICY "relationship visible to either organization" ON "public"."organization_relationships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_org_member(clinic_organization_id) OR is_org_member(lab_organization_id)));
