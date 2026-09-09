-- lab_profiles — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_profile_org_is_lab' AND conrelid = 'public.lab_profiles'::regclass) THEN
        ALTER TABLE "public"."lab_profiles" ADD CONSTRAINT "lab_profile_org_is_lab" CHECK (organization_is_type(organization_id, 'lab'::text));
    END IF;
END $$;

DROP POLICY IF EXISTS "lab members manage own profile" ON "public"."lab_profiles";

CREATE POLICY "lab members manage own profile" ON "public"."lab_profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "public lab profiles are discoverable" ON "public"."lab_profiles";

CREATE POLICY "public lab profiles are discoverable" ON "public"."lab_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((visibility = 'public'::lab_visibility) OR is_org_member(organization_id) OR (EXISTS ( SELECT 1
   FROM organization_relationships r
  WHERE ((r.lab_organization_id = lab_profiles.organization_id) AND (r.status = ANY (ARRAY['pending'::relationship_status, 'active'::relationship_status])) AND is_org_member(r.clinic_organization_id))))));
