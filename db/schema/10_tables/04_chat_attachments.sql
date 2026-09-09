-- chat_attachments — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.chat_attachments
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."chat_attachments" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "message_id" bigint NOT NULL,
    "thread_id" uuid NOT NULL,
    "uploaded_by" uuid NOT NULL,
    "storage_path" text NOT NULL,
    "file_name" text NOT NULL,
    "mime_type" text,
    "size_bytes" bigint NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."chat_attachments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_message_id_fkey' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_fkey" FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_pkey' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_size_bytes_check' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_size_bytes_check" CHECK (size_bytes >= 0 AND size_bytes <= 26214400);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_storage_path_key' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_storage_path_key" UNIQUE (storage_path);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_thread_id_fkey' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_attachments_uploaded_by_fkey' AND conrelid = 'public.chat_attachments'::regclass) THEN
        ALTER TABLE "public"."chat_attachments" ADD CONSTRAINT "chat_attachments_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON public.chat_attachments USING btree (message_id);

CREATE UNIQUE INDEX IF NOT EXISTS chat_attachments_pkey ON public.chat_attachments USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS chat_attachments_storage_path_key ON public.chat_attachments USING btree (storage_path);
