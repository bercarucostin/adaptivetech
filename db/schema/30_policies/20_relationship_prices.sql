-- relationship_prices — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "relationship prices visible to either side" ON "public"."relationship_prices";

CREATE POLICY "relationship prices visible to either side" ON "public"."relationship_prices" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM organization_relationships r
  WHERE ((r.id = relationship_prices.relationship_id) AND (is_org_member(r.clinic_organization_id) OR is_org_member(r.lab_organization_id))))));
