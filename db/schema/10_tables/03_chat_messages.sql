-- chat_messages — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.chat_messages
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" bigint NOT NULL,
    "thread_id" uuid NOT NULL,
    "sender_id" uuid NOT NULL,
    "body" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "edited_at" timestamptz
);

ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_message_has_content' AND conrelid = 'public.chat_messages'::regclass) THEN
        ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_message_has_content" CHECK (NULLIF(TRIM(BOTH FROM COALESCE(body, ''::text)), ''::text) IS NOT NULL OR id IS NOT NULL);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_pkey' AND conrelid = 'public.chat_messages'::regclass) THEN
        ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_sender_id_fkey' AND conrelid = 'public.chat_messages'::regclass) THEN
        ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_thread_id_fkey' AND conrelid = 'public.chat_messages'::regclass) THEN
        ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_pkey ON public.chat_messages USING btree (id);

CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx ON public.chat_messages USING btree (thread_id, created_at DESC, id DESC);
