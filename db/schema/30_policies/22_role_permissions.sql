-- role_permissions — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "role_permissions_authenticated_read" ON "public"."role_permissions";

CREATE POLICY "role_permissions_authenticated_read" ON "public"."role_permissions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
