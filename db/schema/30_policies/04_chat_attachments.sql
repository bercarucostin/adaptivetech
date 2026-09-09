-- chat_attachments — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "chat_attachments_participant_read" ON "public"."chat_attachments";

CREATE POLICY "chat_attachments_participant_read" ON "public"."chat_attachments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (chat_is_thread_participant(thread_id));
