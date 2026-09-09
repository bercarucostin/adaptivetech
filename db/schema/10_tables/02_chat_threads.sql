-- chat_threads — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.chat_threads
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."chat_threads" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "thread_type" text NOT NULL DEFAULT 'direct'::text,
    "direct_key" text,
    "created_by" uuid NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "last_message_at" timestamptz,
    "title" text
);

ALTER TABLE "public"."chat_threads" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_created_by_fkey' AND conrelid = 'public.chat_threads'::regclass) THEN
        ALTER TABLE "public"."chat_threads" ADD CONSTRAINT "chat_threads_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_direct_key_key' AND conrelid = 'public.chat_threads'::regclass) THEN
        ALTER TABLE "public"."chat_threads" ADD CONSTRAINT "chat_threads_direct_key_key" UNIQUE (direct_key);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_pkey' AND conrelid = 'public.chat_threads'::regclass) THEN
        ALTER TABLE "public"."chat_threads" ADD CONSTRAINT "chat_threads_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_shape_check' AND conrelid = 'public.chat_threads'::regclass) THEN
        ALTER TABLE "public"."chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (thread_type = 'direct'::text AND direct_key IS NOT NULL OR thread_type = 'group'::text AND direct_key IS NULL AND NULLIF(TRIM(BOTH FROM COALESCE(title, ''::text)), ''::text) IS NOT NULL);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_thread_type_check' AND conrelid = 'public.chat_threads'::regclass) THEN
        ALTER TABLE "public"."chat_threads" ADD CONSTRAINT "chat_threads_thread_type_check" CHECK (thread_type = ANY (ARRAY['direct'::text, 'group'::text]));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_direct_key_key ON public.chat_threads USING btree (direct_key);

CREATE INDEX IF NOT EXISTS chat_threads_last_message_idx ON public.chat_threads USING btree (last_message_at DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_pkey ON public.chat_threads USING btree (id);

CREATE INDEX IF NOT EXISTS chat_threads_type_idx ON public.chat_threads USING btree (thread_type, last_message_at DESC NULLS LAST);
