-- lab_public_offers — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab members manage own public offers" ON "public"."lab_public_offers";

CREATE POLICY "lab members manage own public offers" ON "public"."lab_public_offers" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_org_member(lab_organization_id)) WITH CHECK (is_org_member(lab_organization_id));

DROP POLICY IF EXISTS "public offer visible when lab profile is visible" ON "public"."lab_public_offers";

CREATE POLICY "public offer visible when lab profile is visible" ON "public"."lab_public_offers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM lab_profiles lp
  WHERE ((lp.organization_id = lab_public_offers.lab_organization_id) AND ((lp.visibility = 'public'::lab_visibility) OR is_org_member(lp.organization_id) OR (EXISTS ( SELECT 1
           FROM organization_relationships r
          WHERE ((r.lab_organization_id = lp.organization_id) AND (r.status = ANY (ARRAY['pending'::relationship_status, 'active'::relationship_status])) AND is_org_member(r.clinic_organization_id)))))))));
