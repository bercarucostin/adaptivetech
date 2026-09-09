-- profiles — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.profiles
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" uuid NOT NULL,
    "display_name" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "username" public."citext",
    "legacy_user_id" text,
    "active" boolean NOT NULL DEFAULT true,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "technician_name" text,
    "legacy_partner_name" text
);

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
        ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pkey' AND conrelid = 'public.profiles'::regclass) THEN
        ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_format' AND conrelid = 'public.profiles'::regclass) THEN
        ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_username_format" CHECK (username IS NULL OR username::text ~ '^[a-z0-9_]{3,40}$'::text);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique ON public.profiles USING btree (username) WHERE (username IS NOT NULL);
