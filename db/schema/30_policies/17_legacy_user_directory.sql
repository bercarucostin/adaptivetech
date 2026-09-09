-- legacy_user_directory — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "legacy_user_directory_self_or_management" ON "public"."legacy_user_directory";

CREATE POLICY "legacy_user_directory_self_or_management" ON "public"."legacy_user_directory" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((lower(legacy_user_id) = lower(COALESCE(current_legacy_user_id(), ''::text))) OR (EXISTS ( SELECT 1
   FROM (organization_memberships m
     JOIN organizations o ON ((o.id = m.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.status = 'active'::membership_status) AND (o.slug = 'flowrise-dental-lab'::text) AND (lower(m.role) = ANY (ARRAY['admin'::text, 'manager'::text])))))));
