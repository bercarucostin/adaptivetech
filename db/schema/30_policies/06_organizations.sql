-- organizations — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "members see own organizations" ON "public"."organizations";

CREATE POLICY "members see own organizations" ON "public"."organizations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_org_member(id));
