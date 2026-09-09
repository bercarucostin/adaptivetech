-- lab_chat_history — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_chat_history_own_insert" ON "public"."lab_chat_history";

CREATE POLICY "lab_chat_history_own_insert" ON "public"."lab_chat_history" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_org_member(lab_organization_id) AND (lower(COALESCE(user_id, ''::text)) = lower(COALESCE(current_legacy_user_id(), ''::text)))));

DROP POLICY IF EXISTS "lab_chat_history_own_read" ON "public"."lab_chat_history";

CREATE POLICY "lab_chat_history_own_read" ON "public"."lab_chat_history" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_org_member(lab_organization_id) AND (lower(COALESCE(user_id, ''::text)) = lower(COALESCE(current_legacy_user_id(), ''::text)))));
