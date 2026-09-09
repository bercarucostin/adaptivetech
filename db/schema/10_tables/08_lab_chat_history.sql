-- lab_chat_history — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_chat_history
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_chat_history" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL DEFAULT nextval('lab_chat_history_id_seq'::regclass),
    "user_id" text,
    "session_id" text,
    "role" text,
    "message" text,
    "created_at" timestamptz,
    "migrated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_chat_history" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_chat_history_lab_organization_id_fkey' AND conrelid = 'public.lab_chat_history'::regclass) THEN
        ALTER TABLE "public"."lab_chat_history" ADD CONSTRAINT "lab_chat_history_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_chat_history_pkey' AND conrelid = 'public.lab_chat_history'::regclass) THEN
        ALTER TABLE "public"."lab_chat_history" ADD CONSTRAINT "lab_chat_history_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lab_chat_history_pkey ON public.lab_chat_history USING btree (lab_organization_id, id);

CREATE INDEX IF NOT EXISTS lab_chat_history_role_idx ON public.lab_chat_history USING btree (lab_organization_id, role);

CREATE INDEX IF NOT EXISTS lab_chat_history_session_time_idx ON public.lab_chat_history USING btree (lab_organization_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lab_chat_history_user_session_time_idx ON public.lab_chat_history USING btree (lab_organization_id, user_id, session_id, created_at DESC);
