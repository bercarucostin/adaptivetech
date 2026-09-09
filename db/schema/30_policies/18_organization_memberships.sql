-- organization_memberships — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "members see own memberships" ON "public"."organization_memberships";

CREATE POLICY "members see own memberships" ON "public"."organization_memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = auth.uid()) OR is_org_member(organization_id)));
