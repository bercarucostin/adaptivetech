-- chat_thread_participants — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.chat_thread_participants
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."chat_thread_participants" (
    "thread_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "joined_at" timestamptz NOT NULL DEFAULT now(),
    "last_read_at" timestamptz
);

ALTER TABLE "public"."chat_thread_participants" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_thread_participants_pkey' AND conrelid = 'public.chat_thread_participants'::regclass) THEN
        ALTER TABLE "public"."chat_thread_participants" ADD CONSTRAINT "chat_thread_participants_pkey" PRIMARY KEY (thread_id, user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_thread_participants_thread_id_fkey' AND conrelid = 'public.chat_thread_participants'::regclass) THEN
        ALTER TABLE "public"."chat_thread_participants" ADD CONSTRAINT "chat_thread_participants_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_thread_participants_user_id_fkey' AND conrelid = 'public.chat_thread_participants'::regclass) THEN
        ALTER TABLE "public"."chat_thread_participants" ADD CONSTRAINT "chat_thread_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_participants_user_idx ON public.chat_thread_participants USING btree (user_id, thread_id);

CREATE UNIQUE INDEX IF NOT EXISTS chat_thread_participants_pkey ON public.chat_thread_participants USING btree (thread_id, user_id);
