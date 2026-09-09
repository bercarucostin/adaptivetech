-- chat_threads — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "chat_threads_participant_read" ON "public"."chat_threads";

CREATE POLICY "chat_threads_participant_read" ON "public"."chat_threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (chat_is_thread_participant(id));
