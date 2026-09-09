-- chat_thread_participants — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "chat_participants_thread_read" ON "public"."chat_thread_participants";

CREATE POLICY "chat_participants_thread_read" ON "public"."chat_thread_participants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (chat_is_thread_participant(thread_id));
