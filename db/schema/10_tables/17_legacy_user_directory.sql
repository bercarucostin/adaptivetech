-- legacy_user_directory — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.legacy_user_directory
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."legacy_user_directory" (
    "legacy_user_id" text NOT NULL,
    "name" text,
    "role" text NOT NULL,
    "technician_name" text,
    "active" boolean NOT NULL DEFAULT true,
    "partner_name" text,
    "migrated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."legacy_user_directory" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legacy_user_directory_pkey' AND conrelid = 'public.legacy_user_directory'::regclass) THEN
        ALTER TABLE "public"."legacy_user_directory" ADD CONSTRAINT "legacy_user_directory_pkey" PRIMARY KEY (legacy_user_id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS legacy_user_directory_pkey ON public.legacy_user_directory USING btree (legacy_user_id);
